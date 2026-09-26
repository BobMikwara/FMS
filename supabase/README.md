# Supabase migrations

`migrations/0001_initial.sql` is the PostgreSQL baseline for SmartFuel. The application does not
run DDL at request time.

For a new project, apply migrations with a direct Supabase database URL:

```bash
DB_PROVIDER=postgresql DATABASE_URL="<direct-connection-url>" npm run db:migrate
```

Use the shared transaction pooler URL on port `6543` for Vercel runtime requests. Do not put a
Supabase service-role key or direct database password in browser-exposed (`NEXT_PUBLIC_*`) values.
