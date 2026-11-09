# Google Workspace sign-in and account sessions

Hosting configuration is pending the user's deployment decision. This guide
prepares the application integration; it does not provision a Google project,
change Workspace policies, or deploy the application.

## What is implemented

- Google OpenID Connect authorization-code sign-in with PKCE, signed short-lived
  state/nonce cookie, and Google's supported token-verification library.
- Verification of the signed hosted-domain (`hd`) claim against an explicit
  Workspace domain allowlist. An email suffix alone is not authorization.
- Existing RakshakAI account approval and role assignment remain authoritative.
  Sign-in does not create accounts or grant Police/Admin roles.
- The Google subject is pinned after the first approved sign-in. A different
  subject cannot take over the same existing account just by matching its email.
- Google access, refresh and ID tokens are not stored or returned to the browser.
  The application creates its own HttpOnly session after the database commits.
- Optional Workspace-only operator sign-in. Citizens can still use their
  existing public-report accounts.
- The header's **Sessions** button lists the current user's active recorded
  sign-ins, signs out another device, or rotates the current session while
  invalidating all other sessions, including older unlisted sign-ins.
- Dashboard sockets revalidate incoming packets and passive connections. A
  revoked/expired/disabled account is disconnected at the next check (at most
  30 seconds by default). A shorter interval can be configured down to 1 second.
- Nginx access logs exclude query strings, referrers and cookies. Any separate
  ingress/proxy must also redact OAuth codes and other sensitive query values.

## Google administrator setup

1. Use an organization-controlled Google Cloud project. Configure an internal
   OAuth consent application where appropriate, and create a **Web application**
   OAuth client. Request only `openid`, `email` and `profile`.
2. Register the exact authorized callback, for example
   `https://rakshakai.example.org/api/auth/google/callback`.
   The application and callback must share one origin through the API proxy.
   Local testing may use `http://localhost:3000/api/auth/google/callback`.
3. Put the client secret in the deployment's secret configuration, never in Git
   or a browser environment variable. Set all five values together:

   ```dotenv
   GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<secret-manager-value>
   GOOGLE_REDIRECT_URI=https://rakshakai.example.org/api/auth/google/callback
   GOOGLE_APP_ORIGIN=https://rakshakai.example.org
   GOOGLE_WORKSPACE_DOMAINS=example.org
   GOOGLE_REQUIRE_WORKSPACE_SSO=false
   ```

   Use the real Workspace domain, not the sample domain. `JWT_SECRET` must have
   at least 32 characters. In production the app requires HTTPS. No configuration
   means the Google button stays hidden; partial configuration fails startup.
   The existing CORS/frontend-origin configuration must allow that same
   application origin.
4. Pre-provision approved accounts with their exact Workspace email and reviewed
   RakshakAI role. Verify at least two approved administrator accounts can sign
   in through Google before disabling password sign-in for operators.
5. In Workspace Admin, enroll users and enforce **2-Step Verification** for the
   required organizational unit/group. Test enrollment, recovery and offboarding.
   RakshakAI does not infer MFA from a normal Google ID token: the Google tenant
   policy must enforce it. The app cannot configure that policy without an
   authorized Google administrator.
6. After successful tests, set `GOOGLE_REQUIRE_WORKSPACE_SSO=true` and restart.
   Admin/Police password login and existing password sessions then stop working;
   approved Workspace sessions continue. Citizen password login remains enabled.
   Use a reviewed recovery procedure; do not enable this flag before testing.

For Docker deployment, pass these variables/secrets to the backend explicitly
through the chosen deployment configuration. Hosting/Compose changes have been
left pending as requested; `.env.docker` values alone are not automatically
passed into a container.

## Session privacy and limits

Session records contain a random non-bearer identifier, sign-in/expiry times,
authentication method and a bounded browser-supplied client description. They do
not contain session tokens, Google tokens, IP addresses or passwords. A client
description is not device attestation. There are at most 20 current recorded
sessions per account; older excess sessions are revoked. Expired entries are
removed when another session is created.

Sessions issued before this update may not be listed. **Sign out other sessions**
changes the account's session version and renews only the caller, invalidating
all prior tokens. Revocation is persisted in PostgreSQL for all app instances;
Socket.IO event distribution between replicas still requires separate reviewed
infrastructure and acceptance testing.

Workspace directory suspension does not automatically revoke an already-issued
RakshakAI cookie. Until reviewed directory lifecycle synchronization is added,
offboarding must disable the RakshakAI account and revoke its sessions as well as
disable the Workspace identity. This integration does not implement SCIM or
Google Cross-Account Protection event ingestion.

## Acceptance tests before enabling operator-only SSO

- Approved Admin and Police accounts sign in through Google and retain roles.
- A non-approved user, unrelated Workspace domain, wrong subject, stale state,
  invalid signature/audience and incorrect nonce cannot obtain an app session.
- Workspace policy actually requires the intended second factor and recovery
  works for the approved administrators.
- Operator password login is blocked only after the reviewed policy is enabled.
- Citizen reporting and existing local demonstration login still work when SSO
  is not configured.
- Remote session revocation persists after reload and disconnects the old live
  dashboard; a new current session remains usable.
- No Google token, secret or authorization code appears in application responses
  or production ingress/access logs.

Local automated tests exercise the application boundaries using a mocked Google
token exchange. A real tenant sign-in and MFA-policy test are still required;
they cannot be established without your OAuth configuration and Workspace admin.

## Official references

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Web server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Deploy Workspace 2-Step Verification](https://knowledge.workspace.google.com/admin/security/deploy-2-step-verification)
