# RakshakAI Security

## Browser sessions

RakshakAI authenticates browser users with signed JWT session cookies.

- Cookies are `HttpOnly`, so application JavaScript cannot read the token.
- Cookies use `SameSite=Strict`.
- Production cookies use the `Secure` attribute and therefore require HTTPS.
- The frontend sends cookies with `credentials: "include"`.
- Authentication tokens are not returned in login/register JSON responses.
- Authentication tokens are not stored in `localStorage` or `sessionStorage`.
- Logout expires both the current `/api` cookie and the previous legacy root
  cookie.

Changing `JWT_SECRET` invalidates existing sessions.

## API protections

- Helmet adds baseline security response headers.
- Express implementation headers are disabled.
- JSON request bodies have a configurable size limit.
- Mutating requests require JSON content where applicable.
- Untrusted browser origins cannot perform mutations.
- General API and login-specific rate limits are enabled.
- Production errors hide internal exception details.
- Admin, Police, and Citizen authorization boundaries are covered by automated
  tests.

Relevant environment variables:

```env
JSON_BODY_LIMIT=1.5mb
API_RATE_LIMIT=600
AUTH_RATE_LIMIT=10
TRUST_PROXY=0
```

Set `TRUST_PROXY=1` only when the backend is deployed behind a trusted reverse
proxy that supplies the correct client IP.

## GIS services

Map search and reverse-geocoding requests are authenticated and proxied through
the backend. Nominatim responses are cached for 24 hours and outbound public
Nominatim requests are serialized to at most one request per second.

The public OpenStreetMap, Nominatim, Esri, and OSRM endpoints are suitable for
development and low-volume demonstrations. For heavy or mission-critical GIS
traffic, self-host the services or use providers with contractual usage limits,
monitoring, support, and an SLA.

## Production requirements

- Serve frontend and backend exclusively over HTTPS.
- Use a strong, unique `JWT_SECRET` from a secret manager.
- Rotate any JWT secret or database credential exposed outside the trusted
  deployment environment.
- Do not commit `.env` files.
- Use PostgreSQL with verified TLS certificates.
- Restrict CORS to exact production frontend origins.
- Configure proxy trust correctly before enabling it.
- Monitor repeated authentication failures and HTTP 429 responses.
- Back up PostgreSQL and periodically test restoration.

The included [Docker Compose setup](DOCKER.md) is intended for local HTTP
development. Production must place the frontend/backend behind HTTPS and use a
secret manager or Docker secrets instead of plain environment-file secrets.

## Verification

Run:

```powershell
npm test
npm run test:security
npm run check
npm run frontend:build
```

Security tests use a temporary copy of the JSON database and a random local
port. They do not require the development backend to be running and do not
modify development data.
