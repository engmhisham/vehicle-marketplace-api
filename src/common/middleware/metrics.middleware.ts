import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as promClient from 'prom-client';

// Initialize default metrics
promClient.collectDefaultMetrics();

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void) {
    const start = Date.now();
    const method = req.method || 'GET';
    const route = req.url || '/';

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const statusCode = res.statusCode.toString();

      httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
      httpRequestTotal.inc({ method, route, status_code: statusCode });
    });

    next();
  }
}

export { promClient };
