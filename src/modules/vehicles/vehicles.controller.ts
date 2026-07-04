import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { FilterVehiclesDto } from './dto/filter-vehicles.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new vehicle listing' })
  @ApiResponse({ status: 201, description: 'Vehicle created' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(user.sub, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List vehicles with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Vehicles list' })
  async findAll(@Query() filters: FilterVehiclesDto) {
    return this.vehiclesService.findAll(filters);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get my vehicles (owner view)' })
  @ApiResponse({ status: 200, description: 'My vehicles list' })
  async findMyVehicles(@CurrentUser() user: JwtPayload, @Query() filters: FilterVehiclesDto) {
    return this.vehiclesService.findByOwner(user.sub, filters);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get vehicle details by ID' })
  @ApiResponse({ status: 200, description: 'Vehicle details' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update vehicle listing' })
  @ApiResponse({ status: 200, description: 'Vehicle updated' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(id, user.sub, user.role, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete vehicle listing' })
  @ApiResponse({ status: 200, description: 'Vehicle deleted' })
  async delete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vehiclesService.delete(id, user.sub, user.role);
  }

  @Post(':id/images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Upload vehicle images' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded' })
  async uploadImages(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Req() req: any) {
    const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    const MAX_FILES = 10;

    const parts = req.files();
    const files: Array<{ buffer: Buffer; originalName: string; mimetype: string }> = [];

    for await (const part of parts) {
      if (files.length >= MAX_FILES) {
        throw new BadRequestException(`Maximum ${MAX_FILES} files allowed per upload`);
      }

      if (!ALLOWED_MIMETYPES.includes(part.mimetype)) {
        throw new BadRequestException(
          `Invalid file type: ${part.mimetype}. Allowed: ${ALLOWED_MIMETYPES.join(', ')}`,
        );
      }

      const buffer = await part.toBuffer();

      if (buffer.length > MAX_FILE_SIZE) {
        throw new BadRequestException(`File ${part.filename} exceeds 5MB limit`);
      }

      files.push({ buffer, originalName: part.filename, mimetype: part.mimetype });
    }

    if (files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    return this.vehiclesService.uploadImages(id, user.sub, user.role, files);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete vehicle image' })
  @ApiResponse({ status: 200, description: 'Image deleted' })
  async deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.vehiclesService.deleteImage(id, imageId, user.sub, user.role);
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DEALER, UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Publish a draft vehicle' })
  @ApiResponse({ status: 200, description: 'Vehicle published' })
  async publish(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vehiclesService.publish(id, user.sub, user.role);
  }
}
