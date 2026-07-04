import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '../auth/decorators/public.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get('vehicles')
  @ApiOperation({ summary: 'Full-text search vehicles' })
  @ApiQuery({ name: 'q', description: 'Search query' })
  @ApiResponse({ status: 200, description: 'Search results' })
  async searchVehicles(@Query('q') query: string, @Query() pagination: PaginationDto) {
    return this.searchService.searchVehicles(query, pagination);
  }

  @Public()
  @Get('suggest')
  @ApiOperation({ summary: 'Search suggestions / autocomplete' })
  @ApiQuery({ name: 'q', description: 'Query prefix' })
  @ApiResponse({ status: 200, description: 'Suggestions' })
  async suggest(@Query('q') query: string) {
    return this.searchService.suggest(query);
  }
}
