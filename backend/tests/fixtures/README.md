# Runtime JSON Test Fixture

`db.fixture.json` is a sanitized deterministic fixture for tests and explicit
PostgreSQL import validation. It is not runtime data.

Test-only fixture accounts use reserved `.test` email domains and generic
identities:

- `admin@example.test`
- `officer@example.test`
- `citizen@example.test`

The fixture password hash was generated from the documented test-only password
`RakshakAI-Fixture-123!` with a fixed test salt. Tests that need login behavior
copy the fixture into a temporary JSON database and replace hashes with their
suite-specific test password.
