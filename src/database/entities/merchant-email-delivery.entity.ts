import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('merchant_email_deliveries')
export class MerchantEmailDelivery {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'operation_key', type: 'char', length: 64, unique: true })
  operationKey: string;

  @Column({ name: 'encrypted_payload', type: 'bytea', select: false })
  encryptedPayload: Buffer;

  @Column({ type: 'varchar', length: 16 })
  status: 'PENDING' | 'ACCEPTED' | 'FAILED';

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  providerMessageId: string | null;

  @Column({ name: 'error_class', type: 'varchar', length: 40, nullable: true })
  errorClass: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
