import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingSession } from '../entities/onboarding-session.entity';

@Injectable()
export class OnboardingSessionRepository {
  constructor(
    @InjectRepository(OnboardingSession)
    private readonly repository: Repository<OnboardingSession>,
  ) {}

  async findByWhatsappId(
    whatsappId: string,
  ): Promise<OnboardingSession | null> {
    return this.repository.findOne({ where: { whatsappId } });
  }

  async save(data: Partial<OnboardingSession>): Promise<OnboardingSession> {
    const existing = data.whatsappId
      ? await this.findByWhatsappId(data.whatsappId)
      : null;

    return this.repository.save(
      this.repository.create({
        ...existing,
        ...data,
        id: existing?.id ?? data.id,
      }),
    );
  }
}
