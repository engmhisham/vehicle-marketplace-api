import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async generateOtp(phone: string): Promise<{ code: string }> {
    const length = this.configService.get<number>('otp.length', 6);
    const expirationMinutes = this.configService.get<number>('otp.expirationMinutes', 5);

    // Generate random OTP
    const code = this.generateRandomCode(length);

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

    // Also store in Redis for quick lookup
    await this.redisService.set(`otp:${phone}`, code, expirationMinutes * 60);

    // Mock SMS service - in production, integrate with Twilio/MessageBird
    this.logger.log(`[MOCK SMS] OTP for ${phone}: ${code}`);

    return { code };
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    // Check Redis first (faster)
    const storedCode = await this.redisService.get(`otp:${phone}`);

    if (storedCode && storedCode === code) {
      // Mark as used and remove from Redis
      await this.redisService.del(`otp:${phone}`);

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
      return true;
    }

    return false;
  }

  private generateRandomCode(length: number): string {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    return code;
  }
}
