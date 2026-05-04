# MoveCircle

MoveCircle is a mobile-first sports social network with:

- registration and login
- friends, private messages and teams
- step and calorie rankings
- local or disabled AI coach mode
- Android build via Capacitor

## Local start

```powershell
npm start
```

Open:

```text
http://127.0.0.1:4173
```

## Android build

Release APK:

```text
android/app/build/outputs/apk/release/app-release.apk
```

## Cloud migration

The backend can now run in two modes:

- local SQLite in `movecircle.db`
- remote libSQL/Turso when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set

Export local data for cloud:

```powershell
npm run export:cloud
```

This generates:

- `sql/schema.sql`
- `sql/seed.sql`

See full cloud steps in:

- `DEPLOYMENT.md`

## Environment

Example env vars are in:

- `.env.example`

Important ones:

- `PORT`
- `AI_MODE`
- `LM_STUDIO_BASE`
- `LM_STUDIO_MODEL`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

## Current architecture

- backend: `server.js`
- web UI: `index.html`, `styles.css`, `app.js`
- local database: `movecircle.db`
- cloud export scripts: `scripts/export-cloud-sql.mjs`

## Deployment

Render config and cloud steps are documented in:

- `DEPLOYMENT.md`
