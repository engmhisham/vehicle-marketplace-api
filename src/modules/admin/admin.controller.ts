import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard stats' })
  @ApiResponse({ status: 200, description: 'Dashboard stats' })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users (with filters)' })
  @ApiQuery({ name: 'role', enum: UserRole, required: false })
  @ApiQuery({ name: 'status', enum: UserStatus, required: false })
  @ApiResponse({ status: 200, description: 'Users list' })
  async listUsers(
    @Query() pagination: PaginationDto,
    @Query('role') role?: UserRole,
    @Query('status') status?: UserStatus,
  ) {
    return this.adminService.listUsers(pagination, role, status);
  }

  @Patch('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend a user' })
  @ApiResponse({ status: 200, description: 'User suspended' })
  async suspendUser(@Param('id') id: string) {
    return this.adminService.deactivateUser(id);
  }

  @Patch('users/:id/activate')
  @ApiOperation({ summary: 'Activate a user' })
  @ApiResponse({ status: 200, description: 'User activated' })
  async activateUser(@Param('id') id: string) {
    return this.adminService.activateUser(id);
  }

  @Get('vehicles/pending')
  @ApiOperation({ summary: 'Get vehicles pending approval' })
  @ApiResponse({ status: 200, description: 'Pending vehicles list' })
  async getPendingVehicles(@Query() pagination: PaginationDto) {
    return this.adminService.getPendingVehicles(pagination);
  }

  @Patch('vehicles/:id/approve')
  @ApiOperation({ summary: 'Approve a vehicle listing' })
  @ApiResponse({ status: 200, description: 'Vehicle approved' })
  async approveVehicle(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.adminService.approveVehicle(id, user.sub);
  }

  @Patch('vehicles/:id/reject')
  @ApiOperation({ summary: 'Reject a vehicle listing' })
  @ApiResponse({ status: 200, description: 'Vehicle rejected' })
  async rejectVehicle(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.adminService.rejectVehicle(id, body.reason);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'View audit logs' })
  @ApiQuery({ name: 'entity', required: false })
  @ApiResponse({ status: 200, description: 'Audit logs' })
  async getAuditLogs(@Query() pagination: PaginationDto, @Query('entity') entity?: string) {
    return this.adminService.getAuditLogs(pagination, entity);
  }
}
