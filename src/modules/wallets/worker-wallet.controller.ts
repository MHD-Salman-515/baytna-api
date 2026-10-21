import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovedWorkerGuard } from '../workers/approved-worker.guard';
import { WalletsService } from './wallets.service';

/** Her own wallet only — every query here is scoped by her own resolved workerProfileId, never a client-supplied one. */
@ApiTags('workers/me/wallet')
@ApiBearerAuth()
@Roles(Role.WORKER)
@UseGuards(ApprovedWorkerGuard)
@Controller('workers/me/wallet')
export class WorkerWalletController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.walletsService.getOwn(user.userId);
  }

  @Get('entries')
  async listOwnEntries(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    const wallet = await this.walletsService.getOwn(user.userId);
    return this.walletsService.listEntries(wallet.workerProfileId.toString(), query);
  }
}
