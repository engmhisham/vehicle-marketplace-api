import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { WalletService } from './wallet.service';
import { TopUpDto, WithdrawDto } from './dto/wallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Wallet')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiResponse({ status: 200, description: 'Balance returned' })
  async getBalance(@CurrentUser() user: JwtPayload) {
    return this.walletService.getBalance(user.sub);
  }

  @Post('top-up')
  @ApiOperation({ summary: 'Top up wallet (mock payment)' })
  @ApiResponse({ status: 201, description: 'Wallet topped up' })
  async topUp(@CurrentUser() user: JwtPayload, @Body() dto: TopUpDto) {
    return this.walletService.topUp(user.sub, dto);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Request withdrawal' })
  @ApiResponse({ status: 201, description: 'Withdrawal requested' })
  async withdraw(@CurrentUser() user: JwtPayload, @Body() dto: WithdrawDto) {
    return this.walletService.requestWithdrawal(user.sub, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiResponse({ status: 200, description: 'Transactions list' })
  async getTransactions(@CurrentUser() user: JwtPayload, @Query() pagination: PaginationDto) {
    return this.walletService.getTransactions(user.sub, pagination);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Get withdrawal history' })
  @ApiResponse({ status: 200, description: 'Withdrawals list' })
  async getWithdrawals(@CurrentUser() user: JwtPayload, @Query() pagination: PaginationDto) {
    return this.walletService.getWithdrawals(user.sub, pagination);
  }

  @Patch('withdrawals/:id/process')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Process withdrawal (Admin only)' })
  @ApiResponse({ status: 200, description: 'Withdrawal processed' })
  async processWithdrawal(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { approved: boolean; note?: string },
  ) {
    return this.walletService.processWithdrawal(id, user.sub, body.approved, body.note);
  }
}
