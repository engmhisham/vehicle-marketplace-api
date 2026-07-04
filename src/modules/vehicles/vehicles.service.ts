import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, UserRole, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RedisService } from '../../redis/redis.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { FilterVehiclesDto } from './dto/filter-vehicles.dto';
import { paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly redisService: RedisService,
  ) {}

  async create(sellerId: string, dto: CreateVehicleDto) {
    const vehicle = await this.prisma.vehicle.create({
      data: {
        sellerId,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        price: dto.price,
        mileage: dto.mileage,
        condition: dto.condition,
        fuelType: dto.fuelType,
        transmission: dto.transmission,
        color: dto.color,
        vin: dto.vin,
        description: dto.description,
        location: dto.location,
        status: VehicleStatus.DRAFT,
      },
      include: { images: true, seller: { select: { id: true, firstName: true, lastName: true } } },
    });

    return vehicle;
  }

  async findAll(filters: FilterVehiclesDto) {
    const where: Prisma.VehicleWhereInput = {};

    if (filters.make) where.make = { contains: filters.make, mode: 'insensitive' };
    if (filters.model) where.model = { contains: filters.model, mode: 'insensitive' };
    if (filters.yearMin || filters.yearMax) {
      where.year = {};
      if (filters.yearMin) where.year.gte = filters.yearMin;
      if (filters.yearMax) where.year.lte = filters.yearMax;
    }
    if (filters.priceMin || filters.priceMax) {
      where.price = {};
      if (filters.priceMin) where.price.gte = filters.priceMin;
      if (filters.priceMax) where.price.lte = filters.priceMax;
    }
    if (filters.condition) where.condition = filters.condition;
    if (filters.fuelType) where.fuelType = filters.fuelType;
    if (filters.transmission) where.transmission = filters.transmission;
    if (filters.status) where.status = filters.status;
    else where.status = VehicleStatus.PUBLISHED; // Default: only show published
    if (filters.location) where.location = { contains: filters.location, mode: 'insensitive' };

    const orderBy: Prisma.VehicleOrderByWithRelationInput = {};
    if (filters.sortBy) {
      orderBy[filters.sortBy as keyof Prisma.VehicleOrderByWithRelationInput] =
        filters.sortOrder || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip: filters.skip,
        take: filters.limit,
        orderBy,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          seller: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return paginate(vehicles, total, filters.page, filters.limit);
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        images: { orderBy: { order: 'asc' } },
        seller: { select: { id: true, firstName: true, lastName: true, phone: true } },
        auction: true,
      },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    // Increment view count in Redis (write-behind to DB)
    try {
      await this.redisService.getClient().hincrby('vehicle:views', id, 1);
    } catch {
      // Fallback: direct DB increment if Redis is down
      await this.prisma.vehicle.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      });
    }

    return vehicle;
  }

  /**
   * Flush accumulated view counts from Redis to PostgreSQL.
   * Called periodically by a cron job.
   */
  async flushViewCounts() {
    const viewCounts = await this.redisService.getClient().hgetall('vehicle:views');
    if (!viewCounts || Object.keys(viewCounts).length === 0) return;

    const entries = Object.entries(viewCounts);
    for (const [vehicleId, count] of entries) {
      const increment = parseInt(count, 10);
      if (increment > 0) {
        await this.prisma.vehicle
          .update({
            where: { id: vehicleId },
            data: { viewCount: { increment } },
          })
          .catch(() => {
            /* vehicle might have been deleted */
          });
        await this.redisService.getClient().hdel('vehicle:views', vehicleId);
      }
    }
  }

  async findByOwner(sellerId: string, filters: FilterVehiclesDto) {
    const where: Prisma.VehicleWhereInput = { sellerId };

    if (filters.status) where.status = filters.status;

    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip: filters.skip,
        take: filters.limit,
        orderBy: { createdAt: 'desc' },
        include: { images: { where: { isPrimary: true }, take: 1 } },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return paginate(vehicles, total, filters.page, filters.limit);
  }

  async update(id: string, userId: string, userRole: string, dto: UpdateVehicleDto) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (vehicle.sellerId !== userId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only edit your own vehicles');
    }

    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: dto,
      include: { images: true },
    });

    return updated;
  }

  async delete(id: string, userId: string, userRole: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { images: true },
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (vehicle.sellerId !== userId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only delete your own vehicles');
    }

    if (vehicle.status === VehicleStatus.IN_AUCTION) {
      throw new BadRequestException('Cannot delete a vehicle that is in an active auction');
    }

    // Delete images from storage
    for (const image of vehicle.images) {
      try {
        await this.storageService.delete(image.key);
      } catch {
        // Continue even if image deletion fails
      }
    }

    await this.prisma.vehicle.delete({ where: { id } });

    return { message: 'Vehicle deleted successfully' };
  }

  async uploadImages(
    vehicleId: string,
    userId: string,
    userRole: string,
    files: Array<{ buffer: Buffer; originalName: string; mimetype: string }>,
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (vehicle.sellerId !== userId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only upload images to your own vehicles');
    }

    // Upload files to storage first
    const uploaded: Array<{ key: string; url: string }> = [];
    for (const file of files) {
      const result = await this.storageService.upload(
        file.buffer,
        file.originalName,
        file.mimetype,
        `vehicles/${vehicleId}`,
      );
      uploaded.push(result);
    }

    // Use transaction with MAX(order) to prevent ordering race condition
    const images = await this.prisma.$transaction(async (tx) => {
      const maxOrder = await tx.vehicleImage.aggregate({
        where: { vehicleId },
        _max: { order: true },
        _count: true,
      });

      const startOrder = (maxOrder._max.order ?? -1) + 1;
      const hasExisting = maxOrder._count > 0;

      const created = [];
      for (let i = 0; i < uploaded.length; i++) {
        const image = await tx.vehicleImage.create({
          data: {
            vehicleId,
            url: uploaded[i].url,
            key: uploaded[i].key,
            isPrimary: !hasExisting && i === 0,
            order: startOrder + i,
          },
        });
        created.push(image);
      }
      return created;
    });

    return images;
  }

  async deleteImage(vehicleId: string, imageId: string, userId: string, userRole: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (vehicle.sellerId !== userId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only manage your own vehicles');
    }

    const image = await this.prisma.vehicleImage.findUnique({ where: { id: imageId } });
    if (!image || image.vehicleId !== vehicleId) {
      throw new NotFoundException('Image not found');
    }

    await this.storageService.delete(image.key);
    await this.prisma.vehicleImage.delete({ where: { id: imageId } });

    return { message: 'Image deleted successfully' };
  }

  async publish(id: string, userId: string, userRole: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    if (vehicle.sellerId !== userId && userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only publish your own vehicles');
    }

    if (vehicle.status !== VehicleStatus.DRAFT) {
      throw new BadRequestException('Only draft vehicles can be published');
    }

    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { status: VehicleStatus.PUBLISHED },
    });

    return updated;
  }
}
