import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        role: true,
        status: true,
        isVerified: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.email) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: userId } },
      });
      if (existingEmail) {
        throw new BadRequestException('Email already in use');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
      },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
        role: true,
      },
    });

    return updated;
  }

  async uploadAvatar(userId: string, file: Buffer, originalName: string, mimetype: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete old avatar if exists
    if (user.avatar) {
      try {
        const oldKey = user.avatar.split('/').slice(-2).join('/');
        await this.storageService.delete(oldKey);
      } catch {
        // Ignore deletion errors for old avatar
      }
    }

    const { url } = await this.storageService.upload(file, originalName, mimetype, 'avatars');

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: url },
    });

    return { avatar: url };
  }

  async changeRole(userId: string, dto: ChangeRoleDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: { id: true, phone: true, role: true },
    });

    return updated;
  }

  async deactivateAccount(userId: string, requesterId: string, requesterRole: string) {
    if (userId !== requesterId && requesterRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only deactivate your own account');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.INACTIVE },
    });

    return { message: 'Account deactivated successfully' };
  }

  async listUsers(pagination: PaginationDto) {
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip: pagination.skip,
        take: pagination.limit,
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
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);

    return paginate(users, total, pagination.page, pagination.limit);
  }
}
