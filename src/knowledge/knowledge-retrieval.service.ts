import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export type PublishedFaq = {
  business_id: string;
  faq_id: string;
  published_revision_id: string;
  question: string;
  answer: string;
  published_at: Date | string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class KnowledgeRetrievalService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async publishedFaqs(businessId: string): Promise<PublishedFaq[]> {
    if (!uuid.test(businessId))
      throw new BadRequestException('Invalid business ID.');
    return this.dataSource.query<PublishedFaq[]>(
      'SELECT * FROM public.kleva_published_faqs($1)',
      [businessId],
    );
  }
}
