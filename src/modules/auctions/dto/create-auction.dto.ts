import { IsString, IsNotEmpty, IsNumber, Min, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuctionDto {
  @ApiProperty({ description: 'Vehicle ID to auction' })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiProperty({ example: 10000, description: 'Starting price' })
  @IsNumber()
  @Min(0)
  startingPrice: number;

  @ApiProperty({ example: 500, description: 'Minimum bid increment' })
  @IsNumber()
  @Min(1)
  bidIncrement: number;

  @ApiProperty({ example: '2024-12-31T23:59:59Z', description: 'Auction start time' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2025-01-07T23:59:59Z', description: 'Auction end time' })
  @IsDateString()
  endTime: string;
}
