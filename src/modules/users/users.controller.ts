import { Body, Controller, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UpdateLocaleDto } from './dto/update-locale.dto';
import { UsersService } from './users.service';

@ApiTags('users/me')
@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('locale')
  async updateLocale(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLocaleDto,
  ): Promise<{ locale: string }> {
    const updated = await this.usersService.updateLocale(user.userId, dto.locale);
    return { locale: updated.locale };
  }
}
