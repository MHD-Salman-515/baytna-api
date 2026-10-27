import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ReasonDto } from '../bookings/dto/reason.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { QueryAdminWalletsDto } from './dto/query-admin-wallets.dto';
import { ReverseWalletEntryDto } from './dto/reverse-wallet-entry.dto';
import { TopupWalletDto } from './dto/topup-wallet.dto';
import { WalletsService } from './wallets.service';

/**
 * Every route here is keyed by `:workerProfileId` (named explicitly, not
 * `:id`) — the same stable identifier admins already use everywhere else
 * in this app (GET /admin/workers/:id). A wallet is looked up/created from
 * it on demand (WalletsService.getOrCreateWallet), never requiring an admin
 * to first discover a separate internal wallet id.
 */
@ApiTags('admin/wallets')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/wallets')
export class AdminWalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  list(@Query() query: QueryAdminWalletsDto) {
    return this.walletsService.listForAdmin(query);
  }

  @Get(':workerProfileId')
  getOne(@Param('workerProfileId', ParseObjectIdPipe) workerProfileId: string) {
    return this.walletsService.getForAdmin(workerProfileId);
  }

  @Get(':workerProfileId/entries')
  listEntries(
    @Param('workerProfileId', ParseObjectIdPipe) workerProfileId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.walletsService.listEntries(workerProfileId, query);
  }

  @Post(':workerProfileId/topup')
  topup(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('workerProfileId', ParseObjectIdPipe) workerProfileId: string,
    @Body() dto: TopupWalletDto,
  ) {
    return this.walletsService.topup(admin.userId, workerProfileId, dto);
  }

  @Post(':workerProfileId/adjust')
  adjust(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('workerProfileId', ParseObjectIdPipe) workerProfileId: string,
    @Body() dto: AdjustWalletDto,
  ) {
    return this.walletsService.adjust(admin.userId, workerProfileId, dto);
  }

  @Post(':workerProfileId/reverse')
  reverse(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('workerProfileId', ParseObjectIdPipe) workerProfileId: string,
    @Body() dto: ReverseWalletEntryDto,
  ) {
    return this.walletsService.reverse(admin.userId, workerProfileId, dto);
  }

  @Post(':workerProfileId/reinstate')
  reinstate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('workerProfileId', ParseObjectIdPipe) workerProfileId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.walletsService.reinstateManually(admin.userId, workerProfileId, dto.reason);
  }
}
