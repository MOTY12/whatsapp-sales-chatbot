import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AgentToolExecutor } from './agent-tool-executor.service';

@Module({
  imports: [DatabaseModule],
  providers: [AgentToolExecutor],
  exports: [AgentToolExecutor],
})
export class AgentToolsModule {}
