import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { OtpService } from './otp.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly otpService: OtpService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (existingUser) {
      throw new ConflictException('Phone number already registered');
    }

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role || UserRole.BUYER,
      },
    });

    // Send OTP for verification
    const otp = await this.otpService.generateOtp(dto.phone);

    this.logger.log(`OTP sent to ${dto.phone}: ${otp.code}`);

    return {
      message: 'Registration successful. Please verify your phone number.',
      userId: user.id,
      // In development, return OTP for testing
      ...(this.configService.get('app.nodeEnv') === 'development' && { otp: otp.code }),
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const isValid = await this.otpService.verifyOtp(dto.phone, dto.code);

    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Mark user as verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.phone, user.role);

    return {
      message: 'Phone verified successfully',
      ...tokens,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException('Phone number not verified');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is deactivated');
    }

    // If user has a password set, require password authentication
    if (user.password) {
      if (!dto.password) {
        throw new UnauthorizedException('Password is required');
      }
      const isPasswordValid = await bcrypt.compare(dto.password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Update last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const tokens = await this.generateTokens(user.id, user.phone, user.role);
      return {
        ...tokens,
        user: {
          id: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      };
    }

    // OTP-based login (only for accounts without password)
    const otp = await this.otpService.generateOtp(dto.phone);

    return {
      message: 'OTP sent to your phone number',
      ...(this.configService.get('app.nodeEnv') === 'development' && { otp: otp.code }),
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    const { refreshToken } = dto;

    // Check if token is blacklisted
    const isBlacklisted = await this.redisService.exists(`blacklist:${refreshToken}`);
    if (isBlacklisted) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Verify refresh token
    let payload: { sub: string; phone: string; role: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Atomically revoke old token - use updateMany with WHERE revokedAt IS NULL
    // This prevents race conditions: only the first request will match
    const result = await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // If no rows updated, token was already revoked (race condition or replay attack)
    if (result.count === 0) {
      throw new UnauthorizedException('Token has already been used');
    }

    // Blacklist old token in Redis
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });
    if (storedToken) {
      const ttl = Math.floor((storedToken.expiresAt.getTime() - Date.now()) / 1000);
      if (ttl > 0) {
        await this.redisService.set(`blacklist:${refreshToken}`, '1', ttl);
      }
    }

    // Generate new token pair
    const tokens = await this.generateTokens(payload.sub, payload.phone, payload.role);

    return tokens;
  }

  async logout(userId: string, accessToken: string, refreshToken: string) {
    // Blacklist the current access token (short TTL - 15 minutes max)
    const accessTtl = 900; // 15 minutes (max access token lifetime)
    await this.redisService.set(`blacklist:${accessToken}`, '1', accessTtl);

    // Revoke refresh token in DB
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (storedToken) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });

      // Blacklist refresh token in Redis
      const ttl = Math.floor((storedToken.expiresAt.getTime() - Date.now()) / 1000);
      if (ttl > 0) {
        await this.redisService.set(`blacklist:${refreshToken}`, '1', ttl);
      }
    }

    return { message: 'Logged out successfully' };
  }

  async setPassword(userId: string, password: string) {
    const hashedPassword = await bcrypt.hash(password, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
    return { message: 'Password set successfully' };
  }

  async requestPasswordReset(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      // Don't reveal whether user exists
      return { message: 'If this phone number is registered, you will receive an OTP' };
    }

    const otp = await this.otpService.generateOtp(phone);

    return {
      message: 'If this phone number is registered, you will receive an OTP',
      ...(this.configService.get('app.nodeEnv') === 'development' && { otp: otp.code }),
    };
  }

  async resetPassword(phone: string, code: string, newPassword: string) {
    const isValid = await this.otpService.verifyOtp(phone, code);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // Revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password reset successfully' };
  }

  private async generateTokens(userId: string, phone: string, role: string) {
    const payload = { sub: userId, phone, role };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: this.configService.get<string>('jwt.accessExpiration', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>('jwt.refreshExpiration', '7d'),
    });

    // Store refresh token in DB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
