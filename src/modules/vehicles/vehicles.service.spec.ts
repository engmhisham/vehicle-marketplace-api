import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RedisService } from '../../redis/redis.service';

describe('VehiclesService', () => {
  let service: VehiclesService;

  const mockPrisma = {
    vehicle: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    vehicleImage: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockStorage = {
    upload: jest.fn(),
    delete: jest.fn(),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehiclesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<VehiclesService>(VehiclesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a vehicle', async () => {
      const dto = {
        make: 'Toyota',
        model: 'Camry',
        year: 2023,
        price: 25000,
      };

      mockPrisma.vehicle.create.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
        ...dto,
        status: 'DRAFT',
        images: [],
        seller: { id: 'user-1', firstName: 'Ahmed', lastName: 'Mohamed' },
      });

      const result = await service.create('user-1', dto);

      expect(result.id).toBe('vehicle-1');
      expect(result.status).toBe('DRAFT');
      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sellerId: 'user-1',
            make: 'Toyota',
            model: 'Camry',
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a vehicle by id', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        make: 'Toyota',
        model: 'Camry',
        images: [],
        seller: { id: 'user-1' },
      });
      mockPrisma.vehicle.update.mockResolvedValue({});

      const result = await service.findOne('vehicle-1');

      expect(result.id).toBe('vehicle-1');
      expect(mockPrisma.vehicle.update).toHaveBeenCalled(); // view count increment
    });

    it('should throw NotFoundException for non-existent vehicle', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update own vehicle', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
      });
      mockPrisma.vehicle.update.mockResolvedValue({
        id: 'vehicle-1',
        make: 'Honda',
        images: [],
      });

      const result = await service.update('vehicle-1', 'user-1', 'DEALER', { make: 'Honda' });

      expect(result.make).toBe('Honda');
    });

    it('should throw ForbiddenException for non-owner', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
      });

      await expect(
        service.update('vehicle-1', 'user-2', 'DEALER', { make: 'Honda' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to update any vehicle', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
      });
      mockPrisma.vehicle.update.mockResolvedValue({
        id: 'vehicle-1',
        make: 'Honda',
        images: [],
      });

      const result = await service.update('vehicle-1', 'admin-1', 'ADMIN', { make: 'Honda' });

      expect(result.make).toBe('Honda');
    });
  });

  describe('delete', () => {
    it('should delete own vehicle', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
        status: 'DRAFT',
        images: [],
      });
      mockPrisma.vehicle.delete.mockResolvedValue({});

      const result = await service.delete('vehicle-1', 'user-1', 'DEALER');

      expect(result.message).toBe('Vehicle deleted successfully');
    });

    it('should not delete vehicle in auction', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-1',
        sellerId: 'user-1',
        status: 'IN_AUCTION',
        images: [],
      });

      await expect(service.delete('vehicle-1', 'user-1', 'DEALER')).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return paginated vehicles with filters', async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([
        { id: 'v1', make: 'Toyota' },
        { id: 'v2', make: 'Toyota' },
      ]);
      mockPrisma.vehicle.count.mockResolvedValue(2);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        skip: 0,
        make: 'Toyota',
      });

      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });
});
