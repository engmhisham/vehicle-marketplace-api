import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as crypto from 'crypto';

const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCKOUT_SECONDS = 900; // 15 minutes
const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const OTP_REQUEST_WINDOW_SECONDS = 300; // 5 minutes

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async generateOtp(phone: string): Promise<{ code: string }> {
    // Rate limit OTP generation per phone
    const requestKey = `otp:requests:${phone}`;
    const requestCount = await this.redisService.incr(requestKey);
    if (requestCount === 1) {
      await this.redisService.expire(requestKey, OTP_REQUEST_WINDOW_SECONDS);
    }
    if (requestCount > MAX_OTP_REQUESTS_PER_WINDOW) {
      throw new BadRequestException('Too many OTP requests. Please try again later.');
    }

    const length = this.configService.get<number>('otp.length', 6);
    const expirationMinutes = this.configService.get<number>('otp.expirationMinutes', 5);

    // Generate cryptographically secure OTP
    const code = this.generateSecureCode(length);

    // Store in database
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expirationMinutes);

    await this.prisma.otpCode.create({
      data: {
        phone,
        code,
        expiresAt,
      },
    });

    // Store in Redis for quick lookup
    await this.redisService.set(`otp:${phone}`, code, expirationMinutes * 60);

    // Mock SMS service - only log in development
    if (this.configService.get('app.nodeEnv') === 'development') {
      this.logger.debug(`[MOCK SMS] OTP for ${phone}: ${code}`);
    } else {
      this.logger.log(`[SMS] OTP sent to ${phone}`);
    }

    return { code };
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    // Check if phone is locked out due to too many failed attempts
    const lockKey = `otp:locked:${phone}`;
    const isLocked = await this.redisService.exists(lockKey);
    if (isLocked) {
      throw new BadRequestException('Too many failed attempts. Please try again in 15 minutes.');
    }

    // Track failed attempts
    const attemptKey = `otp:attempts:${phone}`;

    // Check Redis first (faster)
    const storedCode = await this.redisService.get(`otp:${phone}`);

    if (storedCode && storedCode === code) {
      // Success - clear attempts and OTP
      await this.redisService.del(`otp:${phone}`);
      await this.redisService.del(attemptKey);

      await this.prisma.otpCode.updateMany({
        where: {
          phone,
          code,
          isUsed: false,
          expiresAt: { gte: new Date() },
        },
        data: { isUsed: true },
      });

      return true;
    }

    // Fallback to database
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        phone,
        code,
        isUsed: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (otpRecord) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { isUsed: true },
      });
      await this.redisService.del(`otp:${phone}`);
      await this.redisService.del(attemptKey);
      return true;
    }

    // Failed attempt - increment counter
    const attempts = await this.redisService.incr(attemptKey);
    if (attempts === 1) {
      await this.redisService.expire(attemptKey, OTP_LOCKOUT_SECONDS);
    }

    // Lock out after max attempts
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await this.redisService.set(lockKey, '1', OTP_LOCKOUT_SECONDS);
      await this.redisService.del(attemptKey);
      await this.redisService.del(`otp:${phone}`); // Invalidate existing OTP
      throw new BadRequestException('Too many failed attempts. Account locked for 15 minutes.');
    }

    return false;
  }

  private generateSecureCode(length: number): string {
    const max = Math.pow(10, length);
    const randomNumber = crypto.randomInt(0, max);
    return randomNumber.toString().padStart(length, '0');
  }
}
