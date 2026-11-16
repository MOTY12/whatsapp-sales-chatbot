-- Apply as kleva_migration after every migration. Backup identity is read-only.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO kleva_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO kleva_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE kleva_migration IN SCHEMA public
  GRANT SELECT ON TABLES TO kleva_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE kleva_migration IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO kleva_backup;
