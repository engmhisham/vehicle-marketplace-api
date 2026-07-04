import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { RedisService } from '../../redis/redis.service';

const IDEMPOTENCY_TTL = 86400; // 24 hours

/**
 * Generic idempotency interceptor.
 * Any POST/PUT/PATCH request with an `x-idempotency-key` header will be
 * deduplicated. If the same key was seen before, the cached response is returned.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redisService: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();

    // Only apply to mutating requests
    if (request.method === 'GET' || request.method === 'DELETE') {
      return next.handle();
    }

    const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return next.handle();
    }

    const cacheKey = `idempotency:global:${idempotencyKey}`;

    // Check if we have a cached response
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        response.header('x-idempotent-replayed', 'true');
        return of(JSON.parse(cached));
      }
    } catch {
      // Redis failure - proceed without idempotency
    }

    // Execute the handler and cache the result
    return next.handle().pipe(
      tap(async (data) => {
        try {
          await this.redisService.set(cacheKey, JSON.stringify(data), IDEMPOTENCY_TTL);
        } catch {
          // Best-effort caching
        }
      }),
    );
  }
}
