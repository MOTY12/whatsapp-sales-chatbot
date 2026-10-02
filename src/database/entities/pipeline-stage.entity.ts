import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type PipelineStageType =
  | 'New Lead'
  | 'Interested'
  | 'Negotiating'
  | 'Paid'
  | 'Delivered'
  | 'Lost';

@Entity('pipeline_stages')
@Index(['businessId', 'name'], { unique: true })
export class PipelineStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column()
  name: PipelineStageType;

  @Column({ default: 0 })
  order: number;

  @Column({ nullable: true })
  color: string;

  @Column({ default: 0 })
  dealCount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalValue: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
