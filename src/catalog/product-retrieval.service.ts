import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { PublishedProduct } from './product.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ProductRetrievalService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async publishedProducts(businessId: string): Promise<PublishedProduct[]> {
    if (!uuid.test(businessId))
      throw new BadRequestException('Invalid business ID.');
    return this.dataSource.query<PublishedProduct[]>(
      'SELECT * FROM public.kleva_published_products($1)',
      [businessId],
    );
  }
}
