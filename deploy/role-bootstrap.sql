-- Execute once per environment as the PostgreSQL administrator. Set passwords
-- interactively with \password after these roles exist; never put passwords here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kleva_migration') THEN
    CREATE ROLE kleva_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kleva_runtime_app') THEN
    CREATE ROLE kleva_runtime_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kleva_merchant_app') THEN
    CREATE ROLE kleva_merchant_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kleva_identity_app') THEN
    CREATE ROLE kleva_identity_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kleva_backup') THEN
    CREATE ROLE kleva_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
ALTER DATABASE kleva OWNER TO kleva_migration;
REVOKE ALL ON DATABASE kleva FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE kleva TO kleva_migration;
GRANT CONNECT ON DATABASE kleva TO kleva_runtime_app, kleva_merchant_app, kleva_identity_app, kleva_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO kleva_migration;
GRANT USAGE ON SCHEMA public TO kleva_runtime_app, kleva_merchant_app, kleva_identity_app, kleva_backup;
