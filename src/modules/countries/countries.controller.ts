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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CountriesService } from './countries.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';

@ApiTags('countries')
@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Public()
  @Get()
  findActive() {
    return this.countriesService.findActive();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin')
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.countriesService.findAll(pagination);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.countriesService.findOne(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('admin')
  create(@Body() dto: CreateCountryDto) {
    return this.countriesService.create(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Put('admin/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCountryDto) {
    return this.countriesService.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.countriesService.remove(id);
  }
}
