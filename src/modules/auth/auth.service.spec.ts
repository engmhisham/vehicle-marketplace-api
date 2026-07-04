import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: jest.Mocked<PrismaService>;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let otpService: jest.Mocked<OtpService>;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockJwt = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockRedis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const mockOtp = {
    generateOtp: jest.fn(),
    verifyOtp: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        'app.nodeEnv': 'test',
        'jwt.accessSecret': 'test-secret',
        'jwt.accessExpiration': '15m',
        'jwt.refreshSecret': 'test-refresh-secret',
        'jwt.refreshExpiration': '7d',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: RedisService, useValue: mockRedis },
        { provide: OtpService, useValue: mockOtp },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get(PrismaService);
    jwtService = module.get(JwtService);
    redisService = module.get(RedisService);
    otpService = module.get(OtpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user and send OTP', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        phone: '+201234567890',
        role: 'BUYER',
      });
      mockOtp.generateOtp.mockResolvedValue({ code: '123456' });

      const result = await service.register({
        phone: '+201234567890',
        firstName: 'Ahmed',
      });

      expect(result.message).toBe('Registration successful. Please verify your phone number.');
      expect(result.userId).toBe('user-1');
      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(mockOtp.generateOtp).toHaveBeenCalledWith('+201234567890');
    });

    it('should throw ConflictException if phone exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(service.register({ phone: '+201234567890' })).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyOtp', () => {
    it('should verify OTP and return tokens', async () => {
      mockOtp.verifyOtp.mockResolvedValue(true);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+201234567890',
        role: 'BUYER',
        firstName: 'Ahmed',
        lastName: null,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockJwt.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyOtp({
        phone: '+201234567890',
        code: '123456',
      });

      expect(result.message).toBe('Phone verified successfully');
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('should throw BadRequestException for invalid OTP', async () => {
      mockOtp.verifyOtp.mockResolvedValue(false);

      await expect(service.verifyOtp({ phone: '+201234567890', code: '000000' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('login', () => {
    it('should send OTP for phone-only login', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+201234567890',
        password: null,
        isVerified: true,
        status: 'ACTIVE',
      });
      mockOtp.generateOtp.mockResolvedValue({ code: '123456' });

      const result = await service.login({ phone: '+201234567890' });

      expect((result as any).message).toBe('OTP sent to your phone number');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ phone: '+201234567890' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for unverified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isVerified: false,
        status: 'ACTIVE',
      });

      await expect(service.login({ phone: '+201234567890' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshToken', () => {
    it('should throw UnauthorizedException for blacklisted token', async () => {
      mockRedis.exists.mockResolvedValue(true);

      await expect(service.refreshToken({ refreshToken: 'blacklisted-token' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke refresh token', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-1',
        token: 'refresh-token',
        expiresAt: futureDate,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockRedis.set.mockResolvedValue(undefined);

      const result = await service.logout('user-1', 'access-token', 'refresh-token');

      expect(result.message).toBe('Logged out successfully');
      expect(mockPrisma.refreshToken.update).toHaveBeenCalled();
    });
  });
});
