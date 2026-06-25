# PostgreSQL / Neon Setup

The backend uses PostgreSQL whenever `DATABASE_URL` is configured. Without it,
the local `data/db.json` fallback remains active for development.

## 1. Create a Neon database

1. Create a project at <https://neon.tech>.
2. Open the project dashboard and copy the pooled PostgreSQL connection string.
3. Keep `sslmode=require` in the Neon connection string.

## 2. Configure the backend

Copy the example environment file:

```powershell
cd backend
Copy-Item .env.example .env
```

Set the production values in `backend/.env`:

```text
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
JWT_SECRET=replace-with-a-long-random-secret
CORS_ORIGIN=https://your-frontend.example
```

Never commit `.env` or a real connection string.

## 3. Install and migrate

```powershell
npm install
npm run migrate
```

The migration is idempotent and creates the required tables and indexes.

## 4. Import existing demo data

Run this once if you want to preserve the current `data/db.json` records:

```powershell
npm run import:json
```

Existing IDs are preserved, duplicate IDs are skipped, and plaintext demo
passwords are converted to bcrypt hashes during import.

## 5. Run and verify

```powershell
npm run dev
```

Open:

```text
GET http://localhost:5000/api/health
```

Expected database/auth fields:

```json
{
  "status": "ok",
  "service": "RakshakAI Backend",
  "database": "postgres",
  "auth": "jwt"
}
```

If health reports `"database": "json"`, the running process did not receive
`DATABASE_URL`. Restart the backend after changing `.env`.

## Deployment notes

- Run `npm run migrate` as a release step before starting a new backend version.
- Use the Neon pooled connection string for normal application traffic.
- Set a strong, stable `JWT_SECRET`; changing it signs out all users.
- Restrict `CORS_ORIGIN` to the deployed frontend origin.
- Back up Neon before destructive maintenance or bulk imports.
