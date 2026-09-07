# PostgreSQL and Evidence Recovery

The JSON backup script is not a PostgreSQL/evidence backup. Restore the database
and evidence archive from the same completed recovery set. This procedure supports
PostgreSQL 16 and Docker named evidence volumes. It does not support remote managed
PostgreSQL, custom bind mounts, point-in-time recovery, or online backups.

## Maintenance Window

1. Close ingress and stop all backend replicas, import jobs, migration jobs and
   other database/evidence writers. Wait for active requests to drain. Prevent
   orchestration from restarting writers until the backup completes.
2. Leave PostgreSQL running. Confirm the explicit container/database names below
   belong to the intended deployment. The tool checks the supplied backend is
   stopped; it cannot discover every external writer or verify the supplied
   PostgreSQL container is the backend's database.
3. Choose a new directory on protected storage outside the repository. Its parent
   must already exist. On Windows, configure restrictive NTFS ACLs: Node's POSIX
   file modes do not replace Windows access controls.

Example PowerShell commands; replace container names and paths before execution:

```powershell
node scripts/backup-postgres-evidence.cjs backup --postgres rakshakai-postgres-1 --backend rakshakai-backend-1 --database rakshakai --user rakshakai --output D:\ProtectedBackups\rakshakai-YYYYMMDD-HHMMSS
```

The backend evidence mount defaults to `/app/backend/storage/evidence`. Supply
`--evidence-dir` only when the deployed named-volume mount uses a different path.
Credentials stay inside PostgreSQL; the tool uses container-local database access
and never exports environment files. Database authentication must permit the
explicit database user; authentication failures abort the operation.

The recovery set contains `database.dump`, `evidence.tar.gz` and `manifest.json`.
The manifest is written last and records SHA-256 checksums and sizes. A missing
manifest means an incomplete backup. Never restore it. No existing directory is
overwritten. After success, restart writers, verify health, and reopen ingress.

## Storage and Retention

Recovery sets contain sensitive database records and evidence. These files are
not encrypted by this tool. Encrypt them using the organization's approved backup
storage before transfer; keep access restricted and store an off-host copy. Hashes
detect accidental corruption, not malicious replacement of both files and manifest.
Restore only trusted, access-controlled archives.

Schedule maintenance backups at the agreed RPO, including before migrations.
Assign a backup owner, monitor failed/missing backups, and approve retention under
the applicable evidence-retention policy. Do not prune evidence or backups covered
by legal holds. Keep secrets and required encryption keys in a separate secured
recovery system; they are not included in this set. Scheduling, encryption,
off-host replication and retention automation remain deployment responsibilities.

## Restore to New Targets

1. Preserve the existing deployment and its volumes. Provision an empty PostgreSQL
   16 database with the target owner and a fresh named evidence volume. Create the
   backend container from the matching reviewed image, but leave it stopped.
   Do not start automatic migrations/imports before restoring.
2. Configure secrets through the deployment's secure configuration mechanism.
3. Run against the new target names, never the live deployment:

```powershell
node scripts/backup-postgres-evidence.cjs restore --postgres recovery-postgres-1 --backend recovery-backend-1 --database rakshakai --user rakshakai --input D:\ProtectedBackups\rakshakai-YYYYMMDD-HHMMSS
```

The tool verifies both checksums and rejects populated database/evidence targets.
It restores evidence ownership and permissions, then uses transactional
`pg_restore --single-transaction --exit-on-error --no-owner --no-acl`.
Database roles/grants are deployment configuration, not restored ownership.
If restore fails, keep traffic closed. Preserve the failure for investigation and
retry into new empty targets; the evidence volume may already be populated.
The tool does not erase partial targets or delete existing data.

4. Start only the restored backend, verify readiness and authenticated role access,
   then preview evidence through the API and compare checksums and collection counts.
   Verify reviewed migration compatibility before upgrading the restored schema.
5. Cut over ingress only after acceptance. Retain the original deployment for
   rollback. If verification fails, leave ingress on the original deployment.
   Never merge post-cutover writes automatically back into an older database.

Never use `docker compose down --volumes`, `docker volume prune`, or database
reset commands on a deployment during backup/recovery.

## Repeatable Isolated Drill

```powershell
node --test backend/integration/backup-recovery.test.cjs
```

The drill generates independent source/target Compose projects and temporary
credentials, uploads synthetic evidence, backs up a stopped source, and restores
into an empty target. It verifies authenticated API previews, evidence checksums
and collection counts; also rejects running-backend backups, corrupted manifests
and attempts to overwrite populated targets. Only its generated containers,
volumes and temporary artifacts are removed. It reports elapsed recovery time.
This small synthetic drill is not a production RTO/load measurement. Run a
representative protected-data drill before committing to operational RPO/RTO.

### Recorded Local Drill

On 2026-09-06 the isolated drill passed against the current worktree: source and
restored collection counts matched, one synthetic evidence file previewed through
the authenticated API with the original checksum, and corruption/non-empty-target
safety checks passed. Restore plus verification took 13,915 ms; setup, backup and
verification took 58,831 ms before teardown. These timings apply only to the small
fixture, not the production dataset. No operational data or deployment was used.
