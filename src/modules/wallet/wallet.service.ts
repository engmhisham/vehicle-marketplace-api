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

    const newBalance = Number(wallet.balance) + dto.amount;

    const [updatedWallet, transaction] = await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEPOSIT,
          amount: dto.amount,
          balance: newBalance,
          status: TransactionStatus.COMPLETED,
          referenceId: dto.paymentReference,
          referenceType: 'payment_gateway',
          description: 'Wallet top-up',
          metadata: { paymentReference: dto.paymentReference },
        },
      }),
    ]);

    this.logger.log(`Wallet ${wallet.id} topped up: +${dto.amount}. New balance: ${newBalance}`);

    return {
      wallet: updatedWallet,
      transaction,
    };
  }

  async requestWithdrawal(userId: string, dto: WithdrawDto) {
    const wallet = await this.getOrCreateWallet(userId);

    if (Number(wallet.balance) < dto.amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Hold the amount
    const newBalance = Number(wallet.balance) - dto.amount;

    const [updatedWallet, transaction, withdrawal] = await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      }),
      this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.WITHDRAWAL,
          amount: -dto.amount,
          balance: newBalance,
          status: TransactionStatus.PENDING,
          description: 'Withdrawal request',
        },
      }),
      this.prisma.withdrawal.create({
        data: {
          walletId: wallet.id,
          amount: dto.amount,
          note: dto.note,
          status: WithdrawalStatus.PENDING,
        },
      }),
    ]);

    return { withdrawal, transaction };
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
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { wallet: true },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Withdrawal already processed');
    }

    if (approved) {
      await this.prisma.$transaction([
        this.prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: WithdrawalStatus.APPROVED,
            processedAt: new Date(),
            processedBy: adminId,
            note,
          },
        }),
        this.prisma.transaction.updateMany({
          where: {
            walletId: withdrawal.walletId,
            type: TransactionType.WITHDRAWAL,
            status: TransactionStatus.PENDING,
          },
          data: { status: TransactionStatus.COMPLETED },
        }),
      ]);
    } else {
      // Refund the held amount
      const newBalance = Number(withdrawal.wallet.balance) + Number(withdrawal.amount);

      await this.prisma.$transaction([
        this.prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: WithdrawalStatus.REJECTED,
            processedAt: new Date(),
            processedBy: adminId,
            note,
          },
        }),
        this.prisma.wallet.update({
          where: { id: withdrawal.walletId },
          data: { balance: newBalance },
        }),
        this.prisma.transaction.create({
          data: {
            walletId: withdrawal.walletId,
            type: TransactionType.REFUND,
            amount: Number(withdrawal.amount),
            balance: newBalance,
            status: TransactionStatus.COMPLETED,
            referenceId: withdrawalId,
            referenceType: 'withdrawal_refund',
            description: `Withdrawal rejected: ${note || 'No reason provided'}`,
          },
        }),
      ]);
    }

    return { message: `Withdrawal ${approved ? 'approved' : 'rejected'}` };
  }
}
