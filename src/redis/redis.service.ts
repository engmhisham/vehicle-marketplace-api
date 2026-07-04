import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly subscriber: Redis;
  private readonly publisher: Redis;
  private readonly subscriptions: Map<string, (message: string) => void> = new Map();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  constructor(private readonly configService: ConfigService) {
    const redisOptions: RedisOptions = {
      host: this.configService.get<string>('redis.host', 'localhost'),
      port: this.configService.get<number>('redis.port', 6379),
      password: this.configService.get<string>('redis.password'),
      retryStrategy: (times: number) => {
        if (times > this.maxReconnectAttempts) {
          this.logger.error(`Redis connection failed after ${times} attempts`);
          return null; // Stop retrying
        }
        const delay = Math.min(times * 1000, 30000); // Exponential backoff, max 30s
        this.logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      maxRetriesPerRequest: 3,
    };

    this.client = new Redis(redisOptions);
    this.subscriber = new Redis(redisOptions);
    this.publisher = new Redis(redisOptions);

    this.setupSubscriberReconnection();
  }

  private setupSubscriberReconnection() {
    this.subscriber.on('error', (error) => {
      this.logger.error('Redis subscriber error', error.message);
    });

    this.subscriber.on('connect', () => {
      this.logger.log('Redis subscriber connected');
      this.reconnectAttempts = 0;
    });

    // Re-subscribe to all channels on reconnect
    this.subscriber.on('ready', async () => {
      if (this.subscriptions.size > 0) {
        this.logger.log(`Re-subscribing to ${this.subscriptions.size} channels`);
        for (const [channel] of this.subscriptions) {
          if (channel.includes('*')) {
            await this.subscriber.psubscribe(channel).catch((e) => {
              this.logger.error(`Failed to psubscribe to ${channel}`, e);
            });
          } else {
            await this.subscriber.subscribe(channel).catch((e) => {
              this.logger.error(`Failed to subscribe to ${channel}`, e);
            });
          }
        }
      }
    });
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  getPublisher(): Redis {
    return this.publisher;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    this.subscriptions.set(channel, callback);
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment);
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.subscriber.quit();
    await this.publisher.quit();
  }
}
