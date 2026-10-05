import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { QuotePreviewQueryDto } from './dto/quote-preview-query.dto';
import { PricingService } from './pricing.service';
import { toCustomerQuotePreview } from './to-customer-quote-preview';

@ApiTags('pricing')
@ApiBearerAuth()
@Roles(Role.CUSTOMER)
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // Customer-facing preview, before any booking exists — deliberately
  // returns only toCustomerQuotePreview()'s filtered shape, never the full
  // internal Quote (which carries commissionAmount/workerEarnings).
  @Get('quote')
  async quote(@Query() query: QuotePreviewQueryDto) {
    const quote = await this.pricingService.quote(query.workerServiceId, {
      estimatedHours: query.estimatedHours,
      roomCount: query.roomCount,
    });
    return toCustomerQuotePreview(quote);
  }
}
