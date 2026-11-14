import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OutboxStore } from './outbox.store';

@Module({
  imports: [DatabaseModule],
  providers: [OutboxStore],
  exports: [OutboxStore],
})
export class OutboxModule {}
