import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { promClient } from '../middleware/metrics.middleware';
import { Public } from '../../modules/auth/decorators/public.decorator';

@ApiTags('Metrics')
@Controller()
export class MetricsController {
  @Public()
  @Get('metrics')
  @ApiExcludeEndpoint()
  async getMetrics() {
    const metrics = await promClient.register.metrics();
    return metrics;
  }
}
