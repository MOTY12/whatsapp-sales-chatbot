import { DynamicModule, Inject, Provider } from '@nestjs/common';

type Entity = { name?: string };

export function getRepositoryToken(entity: Entity): string {
  return `${entity.name ?? 'Entity'}Repository`;
}

export function InjectRepository(entity: Entity): ParameterDecorator {
  return Inject(getRepositoryToken(entity));
}

function createRepositoryStub(): Record<string, jest.Mock> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

export class TypeOrmModule {
  static forRoot(): DynamicModule {
    return { module: TypeOrmModule };
  }

  static forFeature(entities: Entity[]): DynamicModule {
    const providers: Provider[] = entities.map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue: createRepositoryStub(),
    }));

    return { module: TypeOrmModule, providers, exports: providers };
  }
}
