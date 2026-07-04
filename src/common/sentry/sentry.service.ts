import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Sentry integration service.
 *
 * To enable, install @sentry/node and set SENTRY_DSN in .env:
 *   npm install @sentry/node
 *   SENTRY_DSN=https://your-dsn@sentry.io/project-id
 *
 * This service provides a graceful no-op when Sentry is not configured,
 * so it won't crash the application if the DSN is missing.
 */
@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private sentry: any = null;
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const dsn = this.configService.get<string>('SENTRY_DSN');
    if (!dsn) {
      this.logger.log('Sentry DSN not configured - error tracking disabled');
      return;
    }

    try {
      // Dynamic import to avoid requiring @sentry/node as a hard dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Sentry = await (Function('return import("@sentry/node")')() as Promise<any>).catch(
        () => null,
      );
      if (!Sentry) {
        this.logger.warn(
          'Sentry DSN configured but @sentry/node not installed. Run: npm install @sentry/node',
        );
        return;
      }

      Sentry.init({
        dsn,
        environment: this.configService.get<string>('app.nodeEnv', 'development'),
        tracesSampleRate:
          this.configService.get<string>('app.nodeEnv') === 'production' ? 0.1 : 1.0,
      });

      this.sentry = Sentry;
      this.enabled = true;
      this.logger.log('Sentry error tracking initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Sentry', error);
    }
  }

  captureException(error: Error, context?: Record<string, any>) {
    if (!this.enabled || !this.sentry) return;

    this.sentry.withScope((scope: any) => {
      if (context) {
        scope.setExtras(context);
      }
      this.sentry.captureException(error);
    });
  }

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    if (!this.enabled || !this.sentry) return;
    this.sentry.captureMessage(message, level);
  }

  setUser(user: { id: string; phone?: string; role?: string }) {
    if (!this.enabled || !this.sentry) return;
    this.sentry.setUser(user);
  }

  setTag(key: string, value: string) {
    if (!this.enabled || !this.sentry) return;
    this.sentry.setTag(key, value);
  }
}
