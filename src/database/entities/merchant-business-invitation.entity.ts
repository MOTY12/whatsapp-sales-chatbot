import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('merchant_business_invitations')
export class MerchantBusinessInvitation {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'business_id', type: 'uuid' }) businessId: string;
  @Column({ name: 'recipient_email', type: 'text' }) recipientEmail: string;
  @Column({ name: 'invited_role', type: 'text' }) invitedRole:
    'editor' | 'agent';
  @Column({ name: 'credential_digest', type: 'text', select: false })
  credentialDigest: string;
  @Column({ name: 'invitation_version', type: 'integer' })
  invitationVersion: number;
  @Column({ type: 'text' }) status:
    'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  @Column({ name: 'delivery_status', type: 'text' }) deliveryStatus:
    'PENDING' | 'QUEUED' | 'FAILED';
  @Column({ name: 'invited_by', type: 'uuid' }) invitedBy: string;
  @Column({ name: 'accepted_by', type: 'uuid', nullable: true }) acceptedBy:
    string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
  @Column({ name: 'revoked_by', type: 'uuid', nullable: true }) revokedBy:
    string | null;
  @Column({ name: 'request_key', type: 'uuid' }) requestKey: string;
  @Column({ name: 'request_digest', type: 'bytea', select: false })
  requestDigest: Buffer;
  @Column({ name: 'resend_count', type: 'integer' }) resendCount: number;
}
