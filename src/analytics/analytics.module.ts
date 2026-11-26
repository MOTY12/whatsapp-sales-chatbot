import { Module } from '@nestjs/common';
import { AuthModule } from '../Auth/auth.module';
import { MerchantSessionGuard } from '../Auth/auth.guards';
import { MerchantAnalyticsController } from './merchant-analytics.controller';
import { MerchantAnalyticsService } from './merchant-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [MerchantAnalyticsController],
  providers: [MerchantAnalyticsService, MerchantSessionGuard],
})
export class AnalyticsModule {}
