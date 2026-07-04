import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchVehicles(query: string, pagination: PaginationDto) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query is required');
    }

    if (query.length > 100) {
      throw new BadRequestException('Search query too long');
    }

    // Sanitize input: remove special tsquery characters to prevent injection
    const sanitized = query.replace(/[&|!():<>*\\'"]/g, ' ').trim();
    if (sanitized.length === 0) {
      return paginate([], 0, pagination.page, pagination.limit);
    }

    // Build safe search terms
    const searchTerms = sanitized
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .map((term) => `${term}:*`)
      .join(' & ');

    if (!searchTerms) {
      return paginate([], 0, pagination.page, pagination.limit);
    }

    const vehicles = await this.prisma.$queryRaw<any[]>`
      SELECT
        v.id,
        v.make,
        v.model,
        v.year,
        v.price,
        v.mileage,
        v.condition,
        v.fuel_type as "fuelType",
        v.transmission,
        v.color,
        v.location,
        v.status,
        v.view_count as "viewCount",
        v.created_at as "createdAt",
        ts_rank(
          to_tsvector('english', coalesce(v.make, '') || ' ' || coalesce(v.model, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.location, '')),
          to_tsquery('english', ${searchTerms})
        ) as rank
      FROM vehicles v
      WHERE
        v.status = 'PUBLISHED'
        AND to_tsvector('english', coalesce(v.make, '') || ' ' || coalesce(v.model, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.location, ''))
        @@ to_tsquery('english', ${searchTerms})
      ORDER BY rank DESC
      LIMIT ${pagination.limit}
      OFFSET ${pagination.skip}
    `;

    const countResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM vehicles v
      WHERE
        v.status = 'PUBLISHED'
        AND to_tsvector('english', coalesce(v.make, '') || ' ' || coalesce(v.model, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.location, ''))
        @@ to_tsquery('english', ${searchTerms})
    `;

    const total = Number(countResult[0].count);

    return paginate(vehicles, total, pagination.page, pagination.limit);
  }

  async suggest(query: string) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    // Sanitize for ILIKE - escape special characters
    const sanitized = query.replace(/[%_\\]/g, '\\$&').trim();

    const suggestions = await this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT make, model
      FROM vehicles
      WHERE
        status = 'PUBLISHED'
        AND (
          make ILIKE ${`%${sanitized}%`}
          OR model ILIKE ${`%${sanitized}%`}
        )
      LIMIT 10
    `;

    return suggestions;
  }
}
