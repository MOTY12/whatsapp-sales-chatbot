import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('merchant_team_invitation_attempts')
export class MerchantTeamInvitationAttempt {
  @PrimaryColumn({ name: 'session_digest', type: 'text', select: false })
  sessionDigest: string;

  @Column({ type: 'integer' })
  attempts: number;

  @Column({ name: 'window_started_at', type: 'timestamptz' })
  windowStartedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
