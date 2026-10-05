import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { FindPricingRulesQueryDto } from './dto/find-pricing-rules-query.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { ServicePricingRulesService } from './service-pricing-rules.service';

@ApiTags('service-pricing-rules')
@Controller('service-pricing-rules')
export class ServicePricingRulesController {
  constructor(private readonly pricingRulesService: ServicePricingRulesService) {}

  @Public()
  @Get()
  findMany(@Query() query: FindPricingRulesQueryDto) {
    return this.pricingRulesService.findMany(query);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.pricingRulesService.findAllForAdmin();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.pricingRulesService.findOne(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('admin')
  create(@Body() dto: CreatePricingRuleDto) {
    return this.pricingRulesService.create(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Put('admin/:id')
  update(@Param('id') id: string, @Body() dto: UpdatePricingRuleDto) {
    return this.pricingRulesService.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.pricingRulesService.remove(id);
  }
}
