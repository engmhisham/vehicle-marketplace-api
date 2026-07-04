import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../database/prisma.service';

describe('WalletService', () => {
  let service: WalletService;

  const mockPrisma = {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    withdrawal: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateWallet', () => {
    it('should return existing wallet', async () => {
      const wallet = { id: 'wallet-1', userId: 'user-1', balance: 1000 };
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);

      const result = await service.getOrCreateWallet('user-1');
      expect(result.id).toBe('wallet-1');
    });

    it('should create wallet if not exists', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: 0,
      });

      const result = await service.getOrCreateWallet('user-1');
      expect(result.balance).toBe(0);
    });
  });

  describe('topUp', () => {
    it('should top up wallet', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: 500,
      });

      // Interactive transaction passes a callback - mock it to execute the callback
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          wallet: {
            update: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: 1500 }),
          },
          transaction: {
            create: jest.fn().mockResolvedValue({ id: 'tx-1', amount: 1000, type: 'DEPOSIT' }),
          },
        };
        return cb(txMock);
      });

      const result = await service.topUp('user-1', { amount: 1000 });
      expect(result.wallet.balance).toBe(1500);
    });
  });

  describe('requestWithdrawal', () => {
    it('should reject withdrawal exceeding balance', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        userId: 'user-1',
        balance: 100,
      });

      // Interactive transaction - mock to execute the callback
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const txMock = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'wallet-1',
              userId: 'user-1',
              balance: 100,
            }),
          },
        };
        return cb(txMock);
      });

      await expect(service.requestWithdrawal('user-1', { amount: 500 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
