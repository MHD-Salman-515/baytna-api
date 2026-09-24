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
import { CitiesService } from './cities.service';
import { CreateCityDto } from './dto/create-city.dto';
import { FindCitiesQueryDto } from './dto/find-cities-query.dto';
import { UpdateCityDto } from './dto/update-city.dto';

@ApiTags('cities')
@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  @Get()
  findByCountry(@Query() query: FindCitiesQueryDto) {
    return this.citiesService.findByCountry(query);
  }

  @Get('admin')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  findAll() {
    return this.citiesService.findAll();
  }

  @Get('admin/:id')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  findOne(@Param('id') id: string) {
    return this.citiesService.findOne(id);
  }

  @Post('admin')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateCityDto) {
    return this.citiesService.create(dto);
  }

  @Put('admin/:id')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateCityDto) {
    return this.citiesService.update(id, dto);
  }

  @Delete('admin/:id')
  @ApiHeader({ name: 'x-admin-key' })
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.citiesService.remove(id);
  }
}
