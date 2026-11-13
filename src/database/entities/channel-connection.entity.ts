import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Business } from './business.entity';

export type ChannelConnectionStatus = 'pending' | 'active' | 'inactive';

@Entity('channel_connections')
@Index(
  'UQ_channel_connections_provider_asset',
  ['provider', 'externalAssetId'],
  {
    unique: true,
  },
)
@Index('IDX_channel_connections_business', ['businessId'])
export class ChannelConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  businessId: string;

  @ManyToOne(() => Business, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'businessId',
    foreignKeyConstraintName: 'FK_channel_connections_business',
  })
  business: Business;

  @Column('varchar')
  provider: string;

  @Column('varchar', { nullable: true })
  externalAccountId: string | null;

  @Column('varchar')
  externalAssetId: string;

  @Column('varchar', { nullable: true })
  displayName: string | null;

  @Column('varchar', { default: 'pending' })
  status: ChannelConnectionStatus;

  @Column('boolean', { default: false })
  legacyBackfill: boolean;

  @Column('timestamptz', { nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
