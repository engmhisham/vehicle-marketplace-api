import { PrismaClient, UserRole, VehicleStatus, VehicleCondition, FuelType, TransmissionType, AuctionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const vehicleMakes = [
  { make: 'Toyota', models: ['Camry', 'Corolla', 'RAV4', 'Land Cruiser', 'Hilux', 'Yaris'] },
  { make: 'Honda', models: ['Civic', 'Accord', 'CR-V', 'HR-V', 'City'] },
  { make: 'BMW', models: ['3 Series', '5 Series', 'X3', 'X5', '7 Series'] },
  { make: 'Mercedes-Benz', models: ['C-Class', 'E-Class', 'S-Class', 'GLC', 'GLE'] },
  { make: 'Hyundai', models: ['Elantra', 'Tucson', 'Santa Fe', 'Accent', 'Creta'] },
  { make: 'Nissan', models: ['Altima', 'Sentra', 'X-Trail', 'Patrol', 'Sunny'] },
  { make: 'Kia', models: ['Sportage', 'Cerato', 'Sorento', 'Seltos', 'Rio'] },
  { make: 'Chevrolet', models: ['Malibu', 'Cruze', 'Captiva', 'Optra', 'Spark'] },
  { make: 'Ford', models: ['Fusion', 'Focus', 'Explorer', 'Edge', 'EcoSport'] },
  { make: 'Volkswagen', models: ['Golf', 'Passat', 'Tiguan', 'Polo', 'Jetta'] },
];

const locations = [
  'Cairo, Egypt', 'Giza, Egypt', 'Alexandria, Egypt', 'Mansoura, Egypt',
  'Tanta, Egypt', 'Assiut, Egypt', 'Riyadh, Saudi Arabia', 'Jeddah, Saudi Arabia',
  'Dubai, UAE', 'Abu Dhabi, UAE', 'Amman, Jordan', 'Beirut, Lebanon',
];

const colors = ['White', 'Black', 'Silver', 'Gray', 'Red', 'Blue', 'Green', 'Brown', 'Gold', 'Beige'];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log('🌱 Starting database seed...');

  // Clean existing data
  await prisma.bid.deleteMany();
  await prisma.auction.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatRoom.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.vehicleImage.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.otpCode.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  console.log('✅ Cleaned existing data');

  // Create Admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.create({
    data: {
      phone: '+201000000001',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'System',
      email: 'admin@marketplace.com',
      role: UserRole.ADMIN,
      isVerified: true,
      status: 'ACTIVE',
    },
  });
  console.log(`👤 Created admin: ${admin.phone}`);

  // Create Dealers
  const dealers = [];
  for (let i = 1; i <= 15; i++) {
    const dealer = await prisma.user.create({
      data: {
        phone: `+20100000${String(100 + i).padStart(4, '0')}`,
        password: await bcrypt.hash('dealer123', 12),
        firstName: `Dealer${i}`,
        lastName: `Auto`,
        email: `dealer${i}@marketplace.com`,
        role: UserRole.DEALER,
        isVerified: true,
        status: 'ACTIVE',
      },
    });
    dealers.push(dealer);
  }
  console.log(`👤 Created ${dealers.length} dealers`);

  // Create Buyers
  const buyers = [];
  for (let i = 1; i <= 35; i++) {
    const buyer = await prisma.user.create({
      data: {
        phone: `+20100000${String(200 + i).padStart(4, '0')}`,
        password: await bcrypt.hash('buyer123', 12),
        firstName: `Buyer${i}`,
        lastName: `User`,
        email: `buyer${i}@marketplace.com`,
        role: UserRole.BUYER,
        isVerified: true,
        status: 'ACTIVE',
      },
    });
    buyers.push(buyer);
  }
  console.log(`👤 Created ${buyers.length} buyers`);

  // Create wallets for all users
  const allUsers = [admin, ...dealers, ...buyers];
  for (const user of allUsers) {
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: user.role === UserRole.BUYER ? randomInt(1000, 50000) : randomInt(0, 10000),
      },
    });
  }
  console.log('💰 Created wallets');

  // Create Vehicles (200 total)
  const vehicles = [];
  for (let i = 0; i < 200; i++) {
    const makeData = randomElement(vehicleMakes);
    const model = randomElement(makeData.models);
    const dealer = randomElement(dealers);
    const year = randomInt(2015, 2024);
    const price = randomInt(5000, 150000);
    const status = i < 150 ? VehicleStatus.PUBLISHED : randomElement([VehicleStatus.DRAFT, VehicleStatus.SOLD, VehicleStatus.ARCHIVED]);

    const vehicle = await prisma.vehicle.create({
      data: {
        sellerId: dealer.id,
        make: makeData.make,
        model,
        year,
        price,
        mileage: randomInt(0, 200000),
        condition: randomElement([VehicleCondition.NEW, VehicleCondition.USED, VehicleCondition.CERTIFIED_PRE_OWNED]),
        fuelType: randomElement([FuelType.GASOLINE, FuelType.DIESEL, FuelType.ELECTRIC, FuelType.HYBRID]),
        transmission: randomElement([TransmissionType.AUTOMATIC, TransmissionType.MANUAL, TransmissionType.CVT]),
        color: randomElement(colors),
        description: `${year} ${makeData.make} ${model} in excellent condition. Well maintained with full service history. Contact for more details.`,
        location: randomElement(locations),
        status,
        viewCount: randomInt(0, 500),
        approvedAt: status === VehicleStatus.PUBLISHED ? new Date() : null,
        approvedBy: status === VehicleStatus.PUBLISHED ? admin.id : null,
      },
    });
    vehicles.push(vehicle);
  }
  console.log(`🚗 Created ${vehicles.length} vehicles`);

  // Create Auctions (10 active)
  const publishedVehicles = vehicles.filter(v => v.status === VehicleStatus.PUBLISHED);
  const auctionVehicles = publishedVehicles.slice(0, 10);

  for (const vehicle of auctionVehicles) {
    const startTime = new Date(Date.now() - randomInt(1, 3) * 24 * 60 * 60 * 1000);
    const endTime = new Date(Date.now() + randomInt(1, 7) * 24 * 60 * 60 * 1000);
    const startingPrice = Number(vehicle.price) * 0.7;
    const bidIncrement = Math.ceil(startingPrice * 0.02);
    const numBids = randomInt(3, 15);
    let currentPrice = startingPrice;

    const auction = await prisma.auction.create({
      data: {
        vehicleId: vehicle.id,
        sellerId: vehicle.sellerId,
        startingPrice,
        currentPrice,
        bidIncrement,
        startTime,
        endTime,
        status: AuctionStatus.ACTIVE,
        totalBids: numBids,
      },
    });

    // Update vehicle status
    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { status: VehicleStatus.IN_AUCTION },
    });

    // Create bids
    for (let b = 0; b < numBids; b++) {
      currentPrice += bidIncrement + randomInt(0, bidIncrement);
      const bidder = randomElement(buyers);

      await prisma.bid.create({
        data: {
          auctionId: auction.id,
          bidderId: bidder.id,
          amount: currentPrice,
          createdAt: new Date(startTime.getTime() + (b + 1) * randomInt(60000, 3600000)),
        },
      });
    }

    // Update auction current price
    await prisma.auction.update({
      where: { id: auction.id },
      data: { currentPrice },
    });
  }
  console.log('🔨 Created 10 active auctions with bids');

  // Create some chat rooms and messages
  for (let i = 0; i < 20; i++) {
    const buyer = randomElement(buyers);
    const dealer = randomElement(dealers);
    const vehicle = randomElement(publishedVehicles);

    const [p1, p2] = [buyer.id, dealer.id].sort();

    const room = await prisma.chatRoom.create({
      data: {
        participant1Id: p1,
        participant2Id: p2,
        vehicleId: vehicle.id,
        lastMessageAt: new Date(),
      },
    });

    // Create messages
    const messageCount = randomInt(3, 10);
    for (let m = 0; m < messageCount; m++) {
      const sender = m % 2 === 0 ? buyer : dealer;
      const messages = [
        'Hi, is this vehicle still available?',
        'Yes, it is! Would you like to schedule a test drive?',
        'What is the lowest price you can offer?',
        'Can you share more photos?',
        'Is the price negotiable?',
        'When can I come see it?',
        'Does it have a warranty?',
        'What about the service history?',
        'I am interested, can we discuss?',
        'Sure, let me know when works for you.',
      ];

      await prisma.chatMessage.create({
        data: {
          roomId: room.id,
          senderId: sender.id,
          content: messages[m % messages.length],
          createdAt: new Date(Date.now() - (messageCount - m) * 3600000),
          readAt: m < messageCount - 2 ? new Date() : null,
        },
      });
    }
  }
  console.log('💬 Created 20 chat rooms with messages');

  // Create notifications
  for (const buyer of buyers.slice(0, 10)) {
    await prisma.notification.create({
      data: {
        userId: buyer.id,
        type: 'AUCTION_STARTED',
        title: 'New Auction Started',
        body: 'A vehicle you may be interested in is now on auction!',
        isRead: Math.random() > 0.5,
      },
    });
  }
  console.log('🔔 Created notifications');

  // Create audit logs
  await prisma.auditLog.createMany({
    data: [
      { userId: admin.id, action: 'USER_CREATED', entity: 'user', entityId: dealers[0].id },
      { userId: admin.id, action: 'VEHICLE_APPROVED', entity: 'vehicle', entityId: vehicles[0].id },
      { userId: admin.id, action: 'USER_SUSPENDED', entity: 'user', entityId: buyers[0].id },
      { userId: admin.id, action: 'WITHDRAWAL_APPROVED', entity: 'withdrawal' },
      { userId: admin.id, action: 'ROLE_CHANGED', entity: 'user', entityId: dealers[1].id },
    ],
  });
  console.log('📋 Created audit logs');

  console.log('\n✅ Database seeded successfully!');
  console.log(`
  Summary:
  - 1 Admin (phone: +201000000001, password: admin123)
  - 15 Dealers (phone: +201000001xx, password: dealer123)
  - 35 Buyers (phone: +201000002xx, password: buyer123)
  - 200 Vehicles
  - 10 Active Auctions with bids
  - 20 Chat rooms with messages
  - Notifications and Audit Logs
  `);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
