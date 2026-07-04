import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const bidLatency = new Trend('bid_latency');

// Configuration
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up
    { duration: '1m', target: 50 },    // Stay at 50 users
    { duration: '30s', target: 100 },  // Spike to 100
    { duration: '1m', target: 100 },   // Stay at 100
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% of requests under 500ms
    errors: ['rate<0.1'],               // Error rate under 10%
    bid_latency: ['p(95)<1000'],        // 95% of bids under 1s
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';

// Helper: register and get token
function getAuthToken() {
  const phone = `+2010${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;

  const registerRes = http.post(`${BASE_URL}/auth/register`, JSON.stringify({
    phone,
    firstName: 'LoadTest',
    lastName: 'User',
  }), { headers: { 'Content-Type': 'application/json' } });

  if (registerRes.status === 201) {
    const body = JSON.parse(registerRes.body);
    if (body.data && body.data.otp) {
      const verifyRes = http.post(`${BASE_URL}/auth/verify-otp`, JSON.stringify({
        phone,
        code: body.data.otp,
      }), { headers: { 'Content-Type': 'application/json' } });

      if (verifyRes.status === 200) {
        const verifyBody = JSON.parse(verifyRes.body);
        return verifyBody.data.accessToken;
      }
    }
  }
  return null;
}

export default function () {
  group('Public Endpoints', () => {
    // Health check
    const healthRes = http.get(`${BASE_URL}/../health`);
    check(healthRes, { 'health check OK': (r) => r.status === 200 });

    // List vehicles
    const vehiclesRes = http.get(`${BASE_URL}/vehicles?page=1&limit=20`);
    check(vehiclesRes, {
      'vehicles list OK': (r) => r.status === 200,
      'has items': (r) => JSON.parse(r.body).data.items !== undefined,
    });
    errorRate.add(vehiclesRes.status !== 200);

    // List auctions
    const auctionsRes = http.get(`${BASE_URL}/auctions`);
    check(auctionsRes, { 'auctions list OK': (r) => r.status === 200 });
    errorRate.add(auctionsRes.status !== 200);

    // Search
    const searchRes = http.get(`${BASE_URL}/search/vehicles?q=toyota`);
    check(searchRes, { 'search OK': (r) => r.status === 200 });

    sleep(1);
  });

  group('Authenticated Endpoints', () => {
    const token = getAuthToken();
    if (!token) {
      errorRate.add(1);
      return;
    }

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    // Get profile
    const profileRes = http.get(`${BASE_URL}/users/me`, { headers: authHeaders });
    check(profileRes, { 'profile OK': (r) => r.status === 200 });

    // Get wallet balance
    const walletRes = http.get(`${BASE_URL}/wallet/balance`, { headers: authHeaders });
    check(walletRes, { 'wallet OK': (r) => r.status === 200 });

    // Get notifications
    const notifRes = http.get(`${BASE_URL}/notifications`, { headers: authHeaders });
    check(notifRes, { 'notifications OK': (r) => r.status === 200 });

    sleep(1);
  });

  group('Auction Bidding (Stress)', () => {
    const token = getAuthToken();
    if (!token) return;

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    // Get active auctions
    const auctionsRes = http.get(`${BASE_URL}/auctions?status=ACTIVE`);
    if (auctionsRes.status !== 200) return;

    const auctions = JSON.parse(auctionsRes.body).data.items;
    if (auctions.length === 0) return;

    const auction = auctions[0];
    const bidAmount = parseFloat(auction.currentPrice) + parseFloat(auction.bidIncrement) + Math.random() * 1000;

    const start = Date.now();
    const bidRes = http.post(`${BASE_URL}/auctions/${auction.id}/bid`, JSON.stringify({
      amount: Math.ceil(bidAmount),
    }), { headers: authHeaders });

    bidLatency.add(Date.now() - start);

    // Bid might fail due to race conditions - that's expected
    check(bidRes, {
      'bid accepted or expected error': (r) => r.status === 201 || r.status === 400,
    });

    sleep(2);
  });
}
