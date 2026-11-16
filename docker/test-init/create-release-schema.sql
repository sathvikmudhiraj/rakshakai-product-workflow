-- Runs once when the disposable release-test PostgreSQL data directory is
-- initialized (compose.test.yaml uses a tmpfs data directory, so this runs on
-- every test run). The schema name must match RAKSHAKAI_TEST_SCHEMA in
-- compose.test.yaml; it satisfies the scoped test-schema safety contract.
CREATE SCHEMA IF NOT EXISTS rakshakai_test_release;
