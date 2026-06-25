# Legacy RakshakAI Files (Deprecated)

These files are the **original monolithic prototype** of RakshakAI and are
**deprecated**. They are kept only for historical reference and must not be used
to run the application.

## What is here

| File | Original purpose |
|------|------------------|
| `server.js` | Legacy Node.js HTTP server on port 4173 (no Express, no Helmet, plaintext JSON auth) |
| `app.js` | Legacy vanilla-JS frontend (1963 lines, no bundler) |
| `index.html` | Legacy HTML shell loaded by `server.js` |
| `styles.css` | Legacy styles for `index.html` |

## Why they were deprecated

- The modern stack under `../frontend/`, `../backend/`, and `../ai-service/`
  replaces every feature here with a production-ready implementation.
- The legacy server stored **plaintext passwords** in `../data/db.json` and used
  an in-memory session map instead of signed JWT cookies.
- The legacy frontend displayed **simulated face-match confidence** (e.g.
  "Face match 91%") even though no face recognition was implemented.
- The legacy server had no rate limiting, no security headers, and no modular
  route/controller architecture.

## Do not run these files

The root `package.json` no longer starts the legacy server. To run RakshakAI,
follow the instructions in `../README.md`:

```powershell
npm install
npm run dev
```

This starts the modern Vite frontend (port 3000) and Express backend (port 5000)
together.

## Safe removal

These files can be deleted once you have confirmed the modern stack works for
your team. They are retained only to ease review of the migration.