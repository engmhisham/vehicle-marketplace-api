import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceBidDto {
  @ApiProperty({ example: 15000, description: 'Bid amount' })
  @IsNumber()
  @Min(0)
  amount: number;
}
