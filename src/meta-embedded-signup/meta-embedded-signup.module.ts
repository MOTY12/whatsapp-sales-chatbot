import { Module } from '@nestjs/common';
import { EmbeddedSignupConnectionService } from './embedded-signup-connection.service';
import { MetaEmbeddedSignupController } from './meta-embedded-signup.controller';
import { MetaEmbeddedSignupService } from './meta-embedded-signup.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [MetaEmbeddedSignupController],
  providers: [EmbeddedSignupConnectionService, MetaEmbeddedSignupService],
  exports: [EmbeddedSignupConnectionService, MetaEmbeddedSignupService],
})
export class MetaEmbeddedSignupModule {}
