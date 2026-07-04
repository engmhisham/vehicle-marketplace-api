import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuctionStatus, UserRole } from '@prisma/client';
import { AuctionsService } from './auctions.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new auction' })
  @ApiResponse({ status: 201, description: 'Auction created' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAuctionDto) {
    return this.auctionsService.create(user.sub, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List auctions' })
  @ApiQuery({ name: 'status', enum: AuctionStatus, required: false })
  @ApiResponse({ status: 200, description: 'Auctions list' })
  async findAll(@Query() pagination: PaginationDto, @Query('status') status?: AuctionStatus) {
    return this.auctionsService.findAll(pagination, status);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get auction details' })
  @ApiResponse({ status: 200, description: 'Auction details' })
  async findOne(@Param('id') id: string) {
    return this.auctionsService.findOne(id);
  }

  @Post(':id/bid')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Place a bid on an auction' })
  @ApiResponse({ status: 201, description: 'Bid placed' })
  @ApiResponse({ status: 400, description: 'Invalid bid' })
  async placeBid(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PlaceBidDto,
  ) {
    return this.auctionsService.placeBid(id, user.sub, dto);
  }

  @Public()
  @Get(':id/bids')
  @ApiOperation({ summary: 'Get bid history for an auction' })
  @ApiResponse({ status: 200, description: 'Bid history' })
  async getBidHistory(@Param('id') id: string, @Query() pagination: PaginationDto) {
    return this.auctionsService.getBidHistory(id, pagination);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cancel an auction' })
  @ApiResponse({ status: 200, description: 'Auction cancelled' })
  async cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.auctionsService.cancelAuction(id, user.sub, user.role);
  }
}
