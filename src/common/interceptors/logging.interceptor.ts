import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyRequest } from 'fastify';
import { v4 as uuid } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const correlationId = (request.headers['x-correlation-id'] as string) || uuid();
    const { method, url } = request;
    const userAgent = request.headers['user-agent'] || '';
    const now = Date.now();

    this.logger.log(`[${correlationId}] ${method} ${url} - ${userAgent}`);

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const statusCode = response.statusCode;
        const duration = Date.now() - now;

        this.logger.log(`[${correlationId}] ${method} ${url} ${statusCode} - ${duration}ms`);
      }),
    );
  }
}
