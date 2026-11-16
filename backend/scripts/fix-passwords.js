// Legacy helper intentionally disabled: it embedded a shared password and could
// update PostgreSQL accounts. Use reset-demo-users.js with distinct local
// SEED_*_PASSWORD values in backend/.env; that command only updates JSON mode.
console.error("This legacy password helper is disabled. Configure local SEED_*_PASSWORD values and use reset-demo-users.js in JSON mode.");
process.exitCode = 1;
