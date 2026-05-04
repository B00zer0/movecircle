# MoveCircle Cloud Deployment

## Status

The backend is now prepared to run with either:

- local SQLite: `movecircle.db`
- cloud libSQL/Turso: `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`

The server chooses Turso automatically when both env vars are present.

## Before deploy

1. Create a Turso/libSQL database.
2. Apply [`sql/schema.sql`](C:\Users\Artur\Documents\Codex\2026-04-20-new-chat-5\sql\schema.sql).
3. If you want existing local users/messages/teams in cloud, generate and import [`sql/seed.sql`](C:\Users\Artur\Documents\Codex\2026-04-20-new-chat-5\sql\seed.sql):

```powershell
npm run export:cloud
```

## Render

Use [`render.yaml`](C:\Users\Artur\Documents\Codex\2026-04-20-new-chat-5\render.yaml) or create a Web Service manually with:

- `Build Command`: `npm install`
- `Start Command`: `npm start`

Required env vars:

- `PORT=4173`
- `AI_MODE=disabled`
- `TURSO_DATABASE_URL=...`
- `TURSO_AUTH_TOKEN=...`

Optional env vars:

- `ADMIN_USERNAME`
- `ADMIN_EMAIL`

## Local checks

Local SQLite mode:

```powershell
$env:TURSO_DATABASE_URL=''
$env:TURSO_AUTH_TOKEN=''
node server.js
```

Cloud mode:

```powershell
node --env-file=.env server.js
```

Then open:

```text
http://127.0.0.1:4173
```

Health endpoint:

```text
/api/health
```

It now reports storage as either `sqlite-local` or `turso`.
