import {
  Body,
  Controller,
  Get,
  Header,
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
import { MerchantLearningService } from './merchant-learning.service';

@Controller('merchant/businesses/:businessId/learning/gaps')
@UseGuards(MerchantSessionGuard)
export class MerchantLearningController {
  constructor(private readonly learning: MerchantLearningService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.learning.list(principal(request), businessId, status, limit);
  }

  @Patch(':clusterId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  updateStatus(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('clusterId') clusterId: string,
    @Body() body: unknown,
  ) {
    return this.learning.updateStatus(
      principal(request),
      businessId,
      clusterId,
      body,
    );
  }
}

@Controller('merchant/businesses/:businessId/learning')
@UseGuards(MerchantSessionGuard)
export class MerchantLearningSuggestionsController {
  constructor(private readonly learning: MerchantLearningService) {}

  @Get('suggestions')
  @Header('Cache-Control', 'no-store')
  suggestions(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
  ) {
    return this.learning.suggestions(principal(request), businessId, status);
  }

  @Get('suggestions/:suggestionId')
  @Header('Cache-Control', 'no-store')
  suggestion(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
  ) {
    return this.learning.suggestion(principal(request), businessId, id);
  }

  @Get('suggestions/:suggestionId/evaluations')
  @Header('Cache-Control', 'no-store')
  evaluations(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
  ) {
    return this.learning.evaluations(principal(request), businessId, id);
  }

  @Post('gaps/:clusterId/suggestions')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  create(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('clusterId') clusterId: string,
    @Body() body: unknown,
  ) {
    return this.learning.createSuggestion(
      principal(request),
      businessId,
      clusterId,
      body,
    );
  }

  @Post('gaps/:clusterId/suggestions/ai-draft')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  aiDraft(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('clusterId') clusterId: string,
  ) {
    return this.learning.draftSuggestionWithAssistant(
      principal(request),
      businessId,
      clusterId,
    );
  }

  @Patch('suggestions/:suggestionId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  edit(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
    @Body() body: unknown,
  ) {
    return this.learning.editSuggestion(
      principal(request),
      businessId,
      id,
      body,
    );
  }

  @Post('suggestions/:suggestionId/submit')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  submit(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
    @Body() body: unknown,
  ) {
    return this.learning.submitSuggestion(
      principal(request),
      businessId,
      id,
      body,
    );
  }

  @Post('suggestions/:suggestionId/approve')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  approve(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
    @Body() body: unknown,
  ) {
    return this.learning.approveSuggestion(
      principal(request),
      businessId,
      id,
      body,
    );
  }

  @Post('suggestions/:suggestionId/retry')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  retry(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
    @Body() body: unknown,
  ) {
    return this.learning.retrySuggestion(
      principal(request),
      businessId,
      id,
      body,
    );
  }

  @Post('suggestions/:suggestionId/dismiss')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  dismiss(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('suggestionId') id: string,
    @Body() body: unknown,
  ) {
    return this.learning.dismissSuggestion(
      principal(request),
      businessId,
      id,
      body,
    );
  }
}
