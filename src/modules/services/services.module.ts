import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServicePricingRulesController } from './service-pricing-rules.controller';
import { ServicePricingRulesService } from './service-pricing-rules.service';
import {
  ServicePricingRule,
  ServicePricingRuleSchema,
} from './schemas/service-pricing-rule.schema';
import { Service, ServiceSchema } from './schemas/service.schema';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Service.name, schema: ServiceSchema },
      { name: ServicePricingRule.name, schema: ServicePricingRuleSchema },
    ]),
  ],
  controllers: [ServicesController, ServicePricingRulesController],
  providers: [ServicesService, ServicePricingRulesService],
  exports: [ServicesService, ServicePricingRulesService],
})
export class ServicesModule {}
