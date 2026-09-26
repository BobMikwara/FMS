# Supabase migrations

`migrations/0001_initial.sql` is the PostgreSQL baseline for SmartFuel. The application does not
run DDL at request time.

For a new project, apply `migrations/0001_initial.sql` in the Supabase SQL Editor, or apply it with a direct Supabase database URL:

```bash
DB_PROVIDER=postgresql DATABASE_URL="<direct-connection-url>" npm run db:migrate
```

For a full demo without Node.js or a local database, open `seed-demo.sql` in the Supabase SQL
Editor and run it after the migration. It creates two organizations, demo users, stations, tanks,
devices, vehicles, readings, movements, alerts, reports, schedules, integrations, settings, and
audit entries. Demo users use `FuelWatch2026!` as their password; change the password in the SQL
file before using it outside a disposable demo project.

The smaller `scripts/seed-postgres.mjs` command remains available for a production bootstrap user
and one station. SMTP is not required for either seed path.

Use the shared transaction pooler URL on port `6543` for Vercel runtime requests. Do not put a
Supabase service-role key or direct database password in browser-exposed (`NEXT_PUBLIC_*`) values.
