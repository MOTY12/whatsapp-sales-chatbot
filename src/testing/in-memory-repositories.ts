import { randomUUID } from 'crypto';
import { Business } from '../database/entities/business.entity';
import { OnboardingSession } from '../database/entities/onboarding-session.entity';
import { User } from '../database/entities/user.entity';

export function createInMemoryBusinessRepository() {
  const items = new Map<string, Business>();

  return {
    async create(data: Partial<Business>): Promise<Business> {
      const now = new Date();
      const business = {
        ...data,
        id: data.id ?? randomUUID(),
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      } as Business;
      items.set(business.id, business);
      return business;
    },
    async findById(id: string): Promise<Business | null> {
      return items.get(id) ?? null;
    },
    async update(id: string, data: Partial<Business>): Promise<Business | null> {
      const existing = items.get(id);
      if (!existing) {
        return null;
      }
      const updated = { ...existing, ...data, updatedAt: new Date() } as Business;
      items.set(id, updated);
      return updated;
    },
  };
}

export function createInMemoryUserRepository() {
  const items = new Map<string, User>();

  return {
    async create(data: Partial<User>): Promise<User> {
      const now = new Date();
      const user = {
        ...data,
        id: data.id ?? randomUUID(),
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      } as User;
      items.set(user.id, user);
      return user;
    },
    async findByWhatsappId(whatsappId: string): Promise<User | null> {
      return (
        [...items.values()].find((user) => user.whatsappId === whatsappId) ??
        null
      );
    },
  };
}

export function createInMemoryOnboardingSessionRepository() {
  const items = new Map<string, OnboardingSession>();

  return {
    async findByWhatsappId(
      whatsappId: string,
    ): Promise<OnboardingSession | null> {
      return items.get(whatsappId) ?? null;
    },
    async save(data: Partial<OnboardingSession>): Promise<OnboardingSession> {
      const existing = data.whatsappId
        ? (items.get(data.whatsappId) ?? null)
        : null;
      const saved = {
        ...existing,
        ...data,
        id: existing?.id ?? data.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as OnboardingSession;
      items.set(saved.whatsappId, saved);
      return saved;
    },
  };
}
