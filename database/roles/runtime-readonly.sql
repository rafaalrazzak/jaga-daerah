-- Grants the Worker runtime role read-only access to application tables.
-- Apply after migrations, as the role that owns the tables (migration role).
-- Create `jaga_readonly` and its credential per environment; never commit real passwords.
-- ALTER DEFAULT PRIVILEGES only covers tables later created by the role running this script.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO jaga_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO jaga_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO jaga_readonly;
