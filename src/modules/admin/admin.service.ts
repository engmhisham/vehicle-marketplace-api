import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole, UserStatus, VehicleStatus, AuctionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      totalVehicles,
      publishedVehicles,
      activeAuctions,
      totalTransactions,
      recentUsers,
      recentVehicles,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.vehicle.count(),
      this.prisma.vehicle.count({ where: { status: VehicleStatus.PUBLISHED } }),
      this.prisma.auction.count({ where: { status: AuctionStatus.ACTIVE } }),
      this.prisma.transaction.count(),
      this.prisma.user.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.vehicle.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    // Revenue from completed transactions
    const revenue = await this.prisma.transaction.aggregate({
      where: { type: 'DEPOSIT', status: 'COMPLETED' },
      _sum: { amount: true },
    });

    return {
      users: { total: totalUsers, active: activeUsers, newThisWeek: recentUsers },
      vehicles: { total: totalVehicles, published: publishedVehicles, newThisWeek: recentVehicles },
      auctions: { active: activeAuctions },
      transactions: { total: totalTransactions },
      revenue: { total: revenue._sum.amount || 0 },
    };
  }

  async listUsers(pagination: PaginationDto, role?: UserRole, status?: UserStatus) {
    const where: any = {};
    if (role) where.role = role;
    if (status) where.status = status;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          status: true,
          isVerified: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { vehicles: true, bids: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(users, total, pagination.page, pagination.limit);
  }

  async deactivateUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });

    return { message: 'User suspended' };
  }

  async activateUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });

    return { message: 'User activated' };
  }

  async approveVehicle(vehicleId: string, adminId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    if (vehicle.status !== VehicleStatus.DRAFT) {
      throw new BadRequestException('Vehicle is not in draft status');
    }

    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: VehicleStatus.PUBLISHED,
        approvedAt: new Date(),
        approvedBy: adminId,
      },
    });

    return { message: 'Vehicle approved and published' };
  }

  async rejectVehicle(vehicleId: string, reason: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: VehicleStatus.ARCHIVED },
    });

    return { message: 'Vehicle rejected', reason };
  }

  async getPendingVehicles(pagination: PaginationDto) {
    const where = { status: VehicleStatus.DRAFT };

    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          seller: { select: { id: true, firstName: true, lastName: true, phone: true } },
          images: { take: 1 },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return paginate(vehicles, total, pagination.page, pagination.limit);
  }

  async getAuditLogs(pagination: PaginationDto, entity?: string) {
    const where: any = {};
    if (entity) where.entity = entity;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(logs, total, pagination.page, pagination.limit);
  }

  async createAuditLog(
    userId: string | null,
    action: string,
    entity: string,
    entityId?: string,
    oldData?: any,
    newData?: any,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        oldData,
        newData,
        ipAddress,
        userAgent,
      },
    });
  }
}
