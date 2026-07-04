import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchVehicles(query: string, pagination: PaginationDto) {
    // PostgreSQL full-text search using raw query for proper ranking
    const searchTerms = query
      .trim()
      .split(/\s+/)
      .map((term) => `${term}:*`)
      .join(' & ');

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
    // Get autocomplete suggestions
    const suggestions = await this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT make, model
      FROM vehicles
      WHERE
        status = 'PUBLISHED'
        AND (
          make ILIKE ${`%${query}%`}
          OR model ILIKE ${`%${query}%`}
        )
      LIMIT 10
    `;

    return suggestions;
  }
}
