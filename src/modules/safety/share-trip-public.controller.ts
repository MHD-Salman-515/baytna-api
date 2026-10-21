import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ShareTripService } from './share-trip.service';

/**
 * The one unauthenticated route in this entire app. See
 * ShareTripService.getPublicView's own comment — this controller does
 * nothing but forward the token; every allowlist/expiry decision lives
 * there, not here, so there's exactly one place to audit.
 */
@ApiTags('share-trip')
@Public()
@Controller('share-trip')
export class ShareTripPublicController {
  constructor(private readonly shareTripService: ShareTripService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.shareTripService.getPublicView(token);
  }
}
