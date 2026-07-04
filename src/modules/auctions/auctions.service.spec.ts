import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

describe('AuctionsService', () => {
  let service: AuctionsService;

  const mockPrisma = {
    vehicle: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auction: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    bid: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRedis = {
    setNX: jest.fn(),
    del: jest.fn(),
    publish: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: getQueueToken('auctions'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AuctionsService>(AuctionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create an auction for own vehicle', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
        status: 'PUBLISHED',
      });
      mockPrisma.auction.findUnique.mockResolvedValue(null);
      mockPrisma.auction.create.mockResolvedValue({
        id: 'auction-1',
        vehicleId: 'vehicle-1',
        startingPrice: 10000,
        currentPrice: 10000,
        status: 'SCHEDULED',
        vehicle: {},
      });
      mockPrisma.vehicle.update.mockResolvedValue({});
      mockQueue.add.mockResolvedValue({});

      const result = await service.create('user-1', {
        vehicleId: 'vehicle-1',
        startingPrice: 10000,
        bidIncrement: 500,
        startTime: new Date(Date.now() + 3600000).toISOString(),
        endTime: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(result.id).toBe('auction-1');
    });

    it('should not allow auctioning non-owned vehicle', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-2',
        status: 'PUBLISHED',
      });

      await expect(
        service.create('user-1', {
          vehicleId: 'vehicle-1',
          startingPrice: 10000,
          bidIncrement: 500,
          startTime: new Date(Date.now() + 3600000).toISOString(),
          endTime: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('placeBid', () => {
    it('should place a valid bid', async () => {
      mockRedis.setNX.mockResolvedValue(true);
      mockPrisma.auction.findUnique.mockResolvedValue({
        id: 'auction-1',
        sellerId: 'seller-1',
        status: 'ACTIVE',
        currentPrice: 10000,
        bidIncrement: 500,
        endTime: new Date(Date.now() + 86400000),
      });

      const bidResult = {
        id: 'bid-1',
        amount: 10500,
        bidder: { id: 'user-1', firstName: 'Ahmed', lastName: 'M' },
      };
      mockPrisma.$transaction.mockResolvedValue([bidResult, {}]);
      mockRedis.publish.mockResolvedValue(undefined);
      mockRedis.del.mockResolvedValue(undefined);

      const result = await service.placeBid('auction-1', 'user-1', { amount: 10500 });

      expect(result.id).toBe('bid-1');
      expect(result.amount).toBe(10500);
    });

    it('should reject bid below minimum', async () => {
      mockRedis.setNX.mockResolvedValue(true);
      mockPrisma.auction.findUnique.mockResolvedValue({
        id: 'auction-1',
        sellerId: 'seller-1',
        status: 'ACTIVE',
        currentPrice: 10000,
        bidIncrement: 500,
        endTime: new Date(Date.now() + 86400000),
      });
      mockRedis.del.mockResolvedValue(undefined);

      await expect(service.placeBid('auction-1', 'user-1', { amount: 10200 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should prevent seller from bidding on own auction', async () => {
      mockRedis.setNX.mockResolvedValue(true);
      mockPrisma.auction.findUnique.mockResolvedValue({
        id: 'auction-1',
        sellerId: 'seller-1',
        status: 'ACTIVE',
        currentPrice: 10000,
        bidIncrement: 500,
        endTime: new Date(Date.now() + 86400000),
      });
      mockRedis.del.mockResolvedValue(undefined);

      await expect(service.placeBid('auction-1', 'seller-1', { amount: 10500 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should handle race condition with lock', async () => {
      mockRedis.setNX.mockResolvedValue(false);

      await expect(service.placeBid('auction-1', 'user-1', { amount: 10500 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
