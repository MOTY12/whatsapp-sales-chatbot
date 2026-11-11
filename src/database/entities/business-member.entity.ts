import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Account } from './account.entity';
import { Business } from './business.entity';

export type BusinessMemberRole = 'owner' | 'staff' | 'editor' | 'agent';

@Entity('business_members')
@Unique('UQ_business_members_account', ['businessId', 'accountId'])
@Unique('UQ_business_members_legacy_user', ['legacyUserId'])
@Unique('UQ_business_members_whatsapp', ['businessId', 'verifiedWhatsappId'])
export class BusinessMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  businessId: string;

  @Column('uuid', { nullable: true })
  accountId: string | null;

  @Column('uuid', { nullable: true })
  legacyUserId: string | null;

  @Column('varchar')
  role: BusinessMemberRole;

  @Column('varchar', { default: 'active' })
  status: 'active' | 'inactive';

  @Column('varchar', { nullable: true })
  verifiedWhatsappId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'businessId',
    foreignKeyConstraintName: 'FK_members_business',
  })
  business: Business;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_members_account',
  })
  account: Account | null;
}
