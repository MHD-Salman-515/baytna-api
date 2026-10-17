import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { UnregisterDeviceTokenDto } from './dto/unregister-device-token.dto';

/** Any authenticated user (customer or worker) may hold device tokens — no role restriction. */
@ApiTags('users/me/device-tokens')
@ApiBearerAuth()
@Controller('users/me/device-tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  @Get()
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.deviceTokensService.listActiveForUser(user.userId);
  }

  @Post()
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceTokenDto) {
    return this.deviceTokensService.register(user.userId, dto);
  }

  // Functionally identical to register (both upsert by token) — kept as its
  // own route because the client's intent ("I'm still here") is different
  // from "I'm a new install", and because the spec calls for it explicitly.
  @Post('refresh')
  refresh(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceTokenDto) {
    return this.deviceTokensService.register(user.userId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnregisterDeviceTokenDto) {
    await this.deviceTokensService.unregister(user.userId, dto.token);
  }
}
