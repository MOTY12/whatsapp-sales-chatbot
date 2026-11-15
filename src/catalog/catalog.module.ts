import { Module } from '@nestjs/common';
import { ProductRetrievalService } from './product-retrieval.service';

@Module({
  providers: [ProductRetrievalService],
  exports: [ProductRetrievalService],
})
export class CatalogModule {}
