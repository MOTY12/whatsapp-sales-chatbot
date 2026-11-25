import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from './auth.guards';
import { MerchantTeamService } from './merchant-team.service';

@Controller('merchant/businesses/:businessId/team')
@UseGuards(MerchantSessionGuard)
export class MerchantTeamController {
  constructor(private readonly team: MerchantTeamService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.team.list(principal(request), businessId, {
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
      role,
      status,
      search,
    });
  }

  @Get('audit')
  @Header('Cache-Control', 'no-store')
  audit(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.team.audit(
      principal(request),
      businessId,
      limit === undefined ? undefined : Number(limit),
      offset === undefined ? undefined : Number(offset),
    );
  }

  @Get('invitations')
  @Header('Cache-Control', 'no-store')
  invitations(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.team.invitations(
      principal(request),
      businessId,
      limit === undefined ? undefined : Number(limit),
      offset === undefined ? undefined : Number(offset),
    );
  }

  @Post('invitations')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  invite(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.team.invite(principal(request), businessId, key, body);
  }

  @Post('invitations/:invitationId/resend')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  resend(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('invitationId') id: string,
  ) {
    return this.team.resend(principal(request), businessId, id);
  }

  @Post('invitations/:invitationId/revoke')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  revokeInvitation(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('invitationId') id: string,
  ) {
    return this.team.revokeInvitation(principal(request), businessId, id);
  }

  @Get(':membershipId')
  @Header('Cache-Control', 'no-store')
  detail(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('membershipId') id: string,
  ) {
    return this.team.detail(principal(request), businessId, id);
  }

  @Patch(':membershipId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  changeRole(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('membershipId') id: string,
    @Body() body: unknown,
  ) {
    return this.team.changeRole(principal(request), businessId, id, body);
  }

  @Post(':membershipId/revoke')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  revokeMember(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('membershipId') id: string,
    @Body() body: unknown,
  ) {
    const version =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).version
        : undefined;
    return this.team.revokeMember(principal(request), businessId, id, version);
  }
}

@Controller('merchant/invitations')
@UseGuards(MerchantSessionGuard)
export class MerchantInvitationController {
  constructor(private readonly team: MerchantTeamService) {}

  @Post('accept')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  accept(@Req() request: MerchantRequest, @Body() body: unknown) {
    return this.team.accept(principal(request).sessionDigest, body);
  }
}
