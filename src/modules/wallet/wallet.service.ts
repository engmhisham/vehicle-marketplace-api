import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { TransactionType, TransactionStatus, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TopUpDto, WithdrawDto } from './dto/wallet.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId },
      });
    }

    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: wallet.balance };
  }

  async topUp(userId: string, dto: TopUpDto) {
    const wallet = await this.getOrCreateWallet(userId);

    // Use interactive transaction with atomic increment to prevent race conditions
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: dto.amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEPOSIT,
          amount: dto.amount,
          balance: updatedWallet.balance,
          status: TransactionStatus.COMPLETED,
          referenceId: dto.paymentReference,
          referenceType: 'payment_gateway',
          description: 'Wallet top-up',
          metadata: { paymentReference: dto.paymentReference },
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    this.logger.log(`Wallet ${wallet.id} topped up: +${dto.amount}`);

    return result;
  }

  async requestWithdrawal(userId: string, dto: WithdrawDto) {
    // Use interactive transaction with optimistic check to prevent race conditions
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read wallet inside transaction for consistency
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        throw new BadRequestException('Wallet not found');
      }

      if (Number(wallet.balance) < dto.amount) {
        throw new BadRequestException('Insufficient balance');
      }

      // Atomic decrement
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: dto.amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.WITHDRAWAL,
          amount: -dto.amount,
          balance: updatedWallet.balance,
          status: TransactionStatus.PENDING,
          description: 'Withdrawal request',
        },
      });

      const withdrawal = await tx.withdrawal.create({
        data: {
          walletId: wallet.id,
          amount: dto.amount,
          note: dto.note,
          status: WithdrawalStatus.PENDING,
        },
      });

      return { withdrawal, transaction };
    });

    return result;
  }

  async getTransactions(userId: string, pagination: PaginationDto) {
    const wallet = await this.getOrCreateWallet(userId);

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { walletId: wallet.id },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where: { walletId: wallet.id } }),
    ]);

    return paginate(transactions, total, pagination.page, pagination.limit);
  }

  async getWithdrawals(userId: string, pagination: PaginationDto) {
    const wallet = await this.getOrCreateWallet(userId);

    const [withdrawals, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where: { walletId: wallet.id },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawal.count({ where: { walletId: wallet.id } }),
    ]);

    return paginate(withdrawals, total, pagination.page, pagination.limit);
  }

  async processWithdrawal(withdrawalId: string, adminId: string, approved: boolean, note?: string) {
    // Use interactive transaction to prevent race conditions on concurrent processing
    await this.prisma.$transaction(async (tx) => {
      // Atomically update only if still PENDING (prevents double-processing)
      const result = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: WithdrawalStatus.PENDING },
        data: {
          status: approved ? WithdrawalStatus.APPROVED : WithdrawalStatus.REJECTED,
          processedAt: new Date(),
          processedBy: adminId,
          note,
        },
      });

      if (result.count === 0) {
        throw new BadRequestException('Withdrawal not found or already processed');
      }

      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        include: { wallet: true },
      });

      if (!withdrawal) {
        throw new NotFoundException('Withdrawal not found');
      }

      if (approved) {
        await tx.transaction.updateMany({
          where: {
            walletId: withdrawal.walletId,
            type: TransactionType.WITHDRAWAL,
            status: TransactionStatus.PENDING,
          },
          data: { status: TransactionStatus.COMPLETED },
        });
      } else {
        // Refund using atomic increment
        const updatedWallet = await tx.wallet.update({
          where: { id: withdrawal.walletId },
          data: { balance: { increment: Number(withdrawal.amount) } },
        });

        await tx.transaction.create({
          data: {
            walletId: withdrawal.walletId,
            type: TransactionType.REFUND,
            amount: Number(withdrawal.amount),
            balance: updatedWallet.balance,
            status: TransactionStatus.COMPLETED,
            referenceId: withdrawalId,
            referenceType: 'withdrawal_refund',
            description: `Withdrawal rejected: ${note || 'No reason provided'}`,
          },
        });
      }
    });

    return { message: `Withdrawal ${approved ? 'approved' : 'rejected'}` };
  }
}
