# Local release verification - 2026-10-19

Final browser release verification completed on 2026-10-20 (Asia/Calcutta).

Deployment remains paused at the user's request. These checks use local,
disposable Docker environments, not production infrastructure. No commit or
push is authorized. Existing worktree changes are preserved.

## Confirmed results

- `npm test`: passed (467 backend and 87 frontend tests).
- `npm run check`: 223 JavaScript files passed. Frontend production build and
  `git diff --check` passed. The approximately 510 kB JS bundle warning remains.
- Critical banner/Copilot rendered checks: all five target viewport sizes passed.
- PostgreSQL TLS: all six handshake/configuration cases passed, including
  trusted hostname acceptance, rejection of untrusted/wrong-host certificates,
  and protection against URL options bypassing verification.
- Operational load: passed with two backend replicas, cross-replica sessions
  and revocation, concurrent dispatch, evidence upload/preview, and recovery
  after an injected commit failure.
- JavaScript dependency audits: root, backend production dependencies and
  frontend each reported zero known vulnerabilities at verification time.
- Container release integration: all 14 cases passed.
- Python 3.11 CPU AI image: built successfully; all 17 tests and `pip check`
  passed inside the rebuilt image. The installed-package advisory scan passed
  with no known vulnerabilities after the remediation below.
- Offline Linux CPU inference with the existing YOLOv8n weights: one result,
  zero detections on a blank 320x320 frame. This is not an accuracy evaluation.

Verified local AI image ID:
`sha256:d1fd7cde123400eaa2ac1c09046c346ca82392734fbe5632902361b59811e472`.
This local image was not pushed or deployed.

## Defects found and corrected during verification

- Firefox mobile CCTNS: asynchronous search/detail rendering detached the
  search and filter controls. Rendering now retains those DOM nodes when the
  category and station choices are unchanged, preserving focus, native select
  interaction and the filter toggle. A regression covers completion between
  pointerdown and click and retained expansion after a detail response.
- WebKit CCTNS: stale result cards remained visible in the input debounce
  window. Query input now invalidates older searches and immediately displays
  loading; an explicit search cancels a pending debounce to avoid duplicate
  refreshes. Regression coverage checks that stale cards disappear immediately
  while the search input remains mounted.
- AI base-image dependency: the audit reported `PYSEC-2026-3447` against
  `setuptools 79.0.1`. The Docker image and CI setup now pin the reported fixed
  version `83.0.0`. The Docker build also checks dependency consistency.

## Synthetic load observations

The workload ran alongside other local verification jobs. These are observations,
not a hardware benchmark, capacity guarantee, or approved production SLO.

| Measurement | Result |
| --- | --- |
| Sustained reads | 265 requests in 15.752 seconds, concurrency 12 |
| Read throughput | 16.82 requests/second |
| Dispatch assignments | 60, concurrency 12 |
| Dispatch p50 / p95 / maximum | 2,158 / 3,947 / 4,671 ms |
| Maximum lock waiters | 12 |
| Evidence upload plus preview | 12 requests, concurrency 4, 393,216-byte payload |
| Upload/preview p95 | 6,746 ms |
| Successful retry after injected commit failure | 162 ms |

Dispatch contention and full-snapshot reads still require representative
workload testing against an agreed latency target before production approval.
The route service was intentionally unavailable; fallback behavior was tested,
not real road-routing quality.

## Final browser release result

- `npm run test:release`: PASS, exit code 0 on 2026-10-20.
- All 45 scenarios passed: Chromium, Firefox and WebKit; Admin, Police Officer
  and Citizen; 1920x1080, 1440x900, 1024x768, 768x1024 and 390x844.
- All 14 container integration checks passed in the same run.
- The runner removed only its disposable project containers/network/evidence
  volume. The ordinary local application was not redeployed.
- Local log: `C:\Users\Admin\AppData\Local\Temp\rakshakai-release-2026-10-20-fc286f212a7b4d15bb8e2c835b10ea90.log`.
- Browser screenshots: `C:\Users\Admin\AppData\Local\Temp\rakshakai-browser-release-lFXl7P`.

These results supersede the interrupted and failed pre-fix browser runs.

## External gates remain open

Live Google Workspace/MFA acceptance, hosting and secrets, production TLS/HA,
off-site recovery and retention, monitoring/on-call, real integration approval,
and representative AI validation are not established by these tests. See
`PRODUCTION_READINESS.md`. No deployment or tenant configuration was changed.
