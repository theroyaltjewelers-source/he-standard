# End-to-end tests

Drives the production build in headless Chromium against a real PostgreSQL 16 database carrying the real migration and row-level security. `server.mjs` is a small local stand-in for the parts of Supabase's REST (PostgREST) and Auth (GoTrue) APIs the app uses; it executes every request as the caller's role, so RLS is enforced by Postgres exactly as in production. Web Push is tested against a local HTTPS push endpoint that decrypts each message with the device keys.

Not covered here (see SETUP.md step 9): Apple/Google push delivery and Supabase's hosted email.

```bash
# 1. Postgres 16 on 127.0.0.1:54322 (user postgres, trust auth), then:
createdb -h 127.0.0.1 -p 54322 -U postgres standard
psql -h 127.0.0.1 -p 54322 -U postgres -d standard -f bootstrap.sql
psql -h 127.0.0.1 -p 54322 -U postgres -d standard -f ../../supabase/migrations/20261027000001_init.sql

# 2. API stand-in (prints ANON and SERVICE keys for .env.local)
npm install && node server.mjs &

# 3. Test HTTPS certificate for the fake push service
openssl req -x509 -newkey rsa:2048 -nodes -keyout push.key -out push.crt -days 2 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"

# 4. App: ../../.env.local points NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321
(cd ../.. && npm run build && NODE_EXTRA_CA_CERTS=tests/e2e/push.crt npm start &)

# 5. Run
node e2e.mjs
```
