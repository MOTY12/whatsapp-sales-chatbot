const REQUIRED_DATABASE_VARS = [
  'DATABASE_HOST',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
] as const;

export function assertRequiredEnv(): void {
  const missing = REQUIRED_DATABASE_VARS.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill in the values.`,
    );
  }
}
