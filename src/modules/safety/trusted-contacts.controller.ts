import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateTrustedContactDto } from './dto/create-trusted-contact.dto';
import { TrustedContactsService } from './trusted-contacts.service';

/** Any authenticated user — customer or worker — manages her own emergency contacts. */
@ApiTags('users/me/trusted-contacts')
@ApiBearerAuth()
@Controller('users/me/trusted-contacts')
export class TrustedContactsController {
  constructor(private readonly trustedContactsService: TrustedContactsService) {}

  @Get()
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.trustedContactsService.listOwn(user.userId);
  }

  @Post()
  addOwn(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTrustedContactDto) {
    return this.trustedContactsService.addOwn(user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOwn(@CurrentUser() user: AuthenticatedUser, @Param('id') contactId: string) {
    await this.trustedContactsService.removeOwn(user.userId, contactId);
  }
}
