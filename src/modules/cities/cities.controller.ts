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
import { CitiesService } from './cities.service';
import { CreateCityDto } from './dto/create-city.dto';
import { FindCitiesQueryDto } from './dto/find-cities-query.dto';
import { UpdateCityDto } from './dto/update-city.dto';

@ApiTags('cities')
@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  @Public()
  @Get()
  findByCountry(@Query() query: FindCitiesQueryDto) {
    return this.citiesService.findByCountry(query);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin')
  findAll() {
    return this.citiesService.findAll();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.citiesService.findOne(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('admin')
  create(@Body() dto: CreateCityDto) {
    return this.citiesService.create(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Put('admin/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCityDto) {
    return this.citiesService.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.citiesService.remove(id);
  }
}
