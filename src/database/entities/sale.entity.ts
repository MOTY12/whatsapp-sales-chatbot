import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Business } from './business.entity';
import { Customer } from './customer.entity';
import { User } from './user.entity';

@Entity('sales')
@Index(['businessId', 'createdAt'])
@Index(['ownerId', 'createdAt'])
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column({ type: 'varchar', nullable: true })
  customerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  ownerId: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  amount: number | null;

  @Column({ type: 'text', nullable: true })
  product: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Business, (business) => business.sales, {
    onDelete: 'CASCADE',
  })
  business: Business;

  @ManyToOne(() => Customer, (customer) => customer.sales, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  customer: Customer | null;

  @ManyToOne(() => User, (user) => user.sales, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  owner: User | null;
}
