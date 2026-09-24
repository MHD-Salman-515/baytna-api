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
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CountriesService } from './countries.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';

@ApiTags('countries')
@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Get()
  findActive() {
    return this.countriesService.findActive();
  }

  @Get('admin')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.countriesService.findAll(pagination);
  }

  @Get('admin/:id')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  findOne(@Param('id') id: string) {
    return this.countriesService.findOne(id);
  }

  @Post('admin')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateCountryDto) {
    return this.countriesService.create(dto);
  }

  @Put('admin/:id')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateCountryDto) {
    return this.countriesService.update(id, dto);
  }

  @Delete('admin/:id')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.countriesService.remove(id);
  }
}
