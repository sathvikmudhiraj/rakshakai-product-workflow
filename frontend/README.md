# RakshakAI Frontend

Vite-powered frontend for the RakshakAI command center.

## Run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Set `VITE_API_BASE_URL` in `.env` when pointing to a different backend.
For production builds served from a separate backend domain, also set
`CSP_CONNECT_SRC` on the HTML-serving frontend container to that backend HTTPS
origin. Leave it empty when the frontend reaches the backend through same-origin
`/api`.
