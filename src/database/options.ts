import { databaseConfig } from '../config/env';
import { databaseLogger } from '../config/logging';
import { databaseEntities } from './schema';

export function databaseOptions(env = process.env) {
  const options = databaseConfig(env);
  return {
    ...options,
    entities: databaseEntities,
    installExtensions: false,
    logger: databaseLogger(options.logging === true),
  };
}
