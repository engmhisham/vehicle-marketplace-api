import { IsNumber, Min, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopUpDto {
  @ApiProperty({ example: 1000, description: 'Amount to top up' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Payment method reference' })
  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class WithdrawDto {
  @ApiProperty({ example: 500, description: 'Amount to withdraw' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ description: 'Note for withdrawal' })
  @IsOptional()
  @IsString()
  note?: string;
}
