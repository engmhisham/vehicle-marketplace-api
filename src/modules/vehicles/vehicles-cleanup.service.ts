import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class VehiclesCleanupService {
  private readonly logger = new Logger(VehiclesCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Run weekly to find and delete orphaned images in MinIO
   * that are no longer referenced in the database.
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOrphanedImages() {
    this.logger.log('Starting orphaned image cleanup...');

    try {
      // Find vehicle images in DB that reference deleted vehicles
      const orphanedImages = await this.prisma.$queryRaw<Array<{ id: string; key: string }>>`
        SELECT vi.id, vi.key
        FROM vehicle_images vi
        LEFT JOIN vehicles v ON vi.vehicle_id = v.id
        WHERE v.id IS NULL
      `;

      if (orphanedImages.length === 0) {
        this.logger.log('No orphaned images found');
        return;
      }

      this.logger.log(`Found ${orphanedImages.length} orphaned images`);

      let deleted = 0;
      for (const image of orphanedImages) {
        try {
          await this.storageService.delete(image.key);
          await this.prisma.vehicleImage.delete({ where: { id: image.id } }).catch(() => {});
          deleted++;
        } catch (error) {
          this.logger.warn(`Failed to delete orphaned image ${image.key}: ${error}`);
        }
      }

      this.logger.log(`Cleanup complete: ${deleted}/${orphanedImages.length} images removed`);
    } catch (error) {
      this.logger.error('Orphaned image cleanup failed', error);
    }
  }
}
