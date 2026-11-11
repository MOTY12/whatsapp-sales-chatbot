import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('accounts')
@Unique('UQ_accounts_issuer_subject', ['issuer', 'subject'])
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  issuer: string;

  @Column()
  subject: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
