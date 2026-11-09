# GitHub Secret Scanning: GoCardless Investigation

**Status: PARTIAL / UNVERIFIED**
**Review date:** 2026-11-09
**Secret values:** Intentionally not displayed, copied, or used.

## Executive summary

The prior version of this report classified the GoCardless alerts as **VERIFIED FALSE POSITIVE**, claimed there was no historical exposure, and said revocation was not required. Those conclusions were unsupported because the original GitHub Secret Scanning alert metadata (including alert IDs and per-location details) was not obtained. They are withdrawn.

The connected GitHub read-only fetch rejected the Secret Scanning alerts endpoint as unsupported. The existing browser access host was unavailable, so the authenticated GitHub Security UI could not be inspected. The old report contains no alert IDs. Accordingly, the exact alert-to-repository/path/line/commit mapping, provider secret type, validity, and current alert state remain **UNVERIFIED**. No alert was dismissed or modified.

Treat any unresolved alert reported as a GoCardless live access token as potentially compromised. The GoCardless account owner should promptly identify the corresponding credential in the provider dashboard and revoke it if active or if exposure cannot be ruled out; then issue a replacement and update authorized secret stores. Do not wait for this report to establish validity.

## Evidence and scope

| Item | Evidence-backed result |
|---|---|
| Repository configured in this local checkout | `sathvikmudhiraj/rakshakai-product-workflow` (remote URL was inspected with any user information suppressed) |
| Repository attached to the original alert | **NOT VERIFIED**; no original alert payload was accessible |
| GitHub Secret Scanning alert IDs | **NOT OBTAINED**; the previous report did not record them |
| Alert state / resolution / validity | **NOT VERIFIED**; no dismiss or resolution action was taken |
| Secret type | Prior report alleges “GoCardless Live Access Token”; **NOT VERIFIED against GitHub metadata** |
| Candidate commit | `5db536e7b6ca2759eaeddd17c2ecae1d8e212963`, identified in the previous report and present in the local checkout |
| Alert-to-commit relationship | **NOT VERIFIED**; the candidate commit is not confirmed as the alert's commit |
| Prior report's candidate locations | 28 `artifacts/**/report.json` paths, listed below; they are candidates only, not confirmed alert locations |
| Prior report's aggregate line references | `20, 82, 94, 116, 130, 140`; no mapping from these lines to alert IDs or individual paths was provided, so they are not treated as authoritative alert locations |
| Credential values | Not emitted, copied, or used for authentication |
| Exclusion changes | None. No blanket `artifacts/**` scanning exclusion was added. |

## Local candidate blob inventory

The following blob IDs were read from the tree of candidate commit `5db536e7b6ca2759eaeddd17c2ecae1d8e212963` using `git ls-tree`. This proves which blob that commit contains at each candidate path; it does **not** prove that GitHub associated any alert with that path or blob. The scan examined only whether the previous report's aggregate line numbers were within each candidate file and whether those lines contained generic credential-field labels, a `live_`-prefixed candidate, or opaque long strings. It did not recover or print any string values. Opaque strings alone do not establish either a credential or a synthetic value.

| Candidate path from previous report | Blob ID at candidate commit | Local line-pattern observation |
|---|---|---|
| `artifacts/gis-fullscreen-audit-2026-11-05/report.json` | `a1b6984f2895734f4ad1f2f9fc6cfc14e4a9a2c7` | No basic credential-pattern indicator at the aggregate referenced lines |
| `artifacts/live-audit-final-2026-11-06/report.json` | `cd4bae876a8df155d830f3cc5e40feebd60894a6` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-map-click-2026-11-06T12-34-10-494Z/report.json` | `809977bf57ce70e6f0bedbab1a46d625d627caa2` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-map-click-2026-11-06T12-35-37-693Z/report.json` | `dddb150c46d03e11cfe87dbe6dac5a435fb59c8c` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-map-click-2026-11-06T12-45-33-867Z/report.json` | `a80cd744a4b5f4f4f4155b7ca7535825a1be0a1e` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-map-click-2026-11-06T12-49-55-758Z/report.json` | `000287a25af1cdef6b212f70a7a61d58dfe2fcd9` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-map-click-2026-11-06T12-53-37-594Z/report.json` | `042f883c94eeea866b0dffae77958e71b45a5081` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-map-click-2026-11-07T14-10-09-546Z/report.json` | `33866d9a1c549abd5d74634bae6f1e791ee80b08` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-map-click-2026-11-07T14-47-51-441Z/report.json` | `efd75ac96921712cb4602f42207d4cf218027b63` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-gis-place-card-final-2026-11-06/report.json` | `272ca6e72ca514fd2f9981dbc1d8b5130c6faae3` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-route-2026-11-06T10-13-19-951Z/report.json` | `edbb68995808ae563774cd724c04ef9678403365` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-route-2026-11-06T10-26-20-451Z/report.json` | `edbb68995808ae563774cd724c04ef9678403365` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-route-2026-11-06T10-47-49-413Z/report.json` | `edbb68995808ae563774cd724c04ef9678403365` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-route-2026-11-07T14-43-13-004Z/report.json` | `7be6f2dcac878c47b3a38b5f23686b40e64864d0` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-route-2026-11-07T14-43-57-016Z/report.json` | `65cec864da37846e5e429e29951b9cce16184b5b` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-gis-route-error-2026-11-06T10-18-40-031Z/report.json` | `52d35e9a5d4054442b4eb412a0b7a0d16e9c80c7` | Two opaque long strings at an aggregate referenced line; unclassified |
| `artifacts/live-mobile-final-2026-11-06/report.json` | `f1ece487cd4f50ea7d0941d5424fbf9100e522d6` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-07-55-200Z/report.json` | `4dc0946fa89977948fe83e376fa5fe454ec96299` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-09-01-422Z/report.json` | `ffffe181564fe25e797dacc8abe3c0271cfcacba` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-13-47-785Z/report.json` | `27d9c8c5aa33687c7be3d284d96bd56c8b957104` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-15-30-205Z/report.json` | `eff347daec091c60854b373e4f4e1b7a31dce0d9` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-41-24-858Z/report.json` | `e2672c6abfaf6683a133fe466bc0dd9a399b3967` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-46-33-228Z/report.json` | `5ec9780e6f645760c24dc109c66de81c34f45621` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/live-ux-review-2026-11-07T14-47-13-741Z/report.json` | `9d5bf978976cc1bcd711721ce06b78509693f543` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/mobile-field-nav-2026-11-06T11-16-09-464Z/report.json` | `cbdb99626325a790a50ca3e3762f4bbbf569f085` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/mobile-field-nav-2026-11-06T11-17-03-299Z/report.json` | `de12e859fb6b3ea91756175945d840bf11dda08b` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/mobile-field-nav-2026-11-06T11-18-55-941Z/report.json` | `acaede86dcca835c86ea003909fd9585ecc87324` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |
| `artifacts/urgent-live-gis-audit-2026-11-05/report.json` | `39028e1566951c90084413e373ddf33e2b5454e5` | No basic credential-pattern indicator at an in-range aggregate line; alert mapping unavailable |

**Interpretation:** This is a local inventory of candidates from the prior report, not a verified Secret Scanning alert match. No candidate is classified as a verified synthetic value or verified real credential. All alert-specific classifications remain **UNRESOLVED** until the original alert metadata and its precise location can be obtained.

## Classification and response

| Classification | Current result | Basis |
|---|---|---|
| Real GoCardless credential | **UNRESOLVED; treat as potentially compromised** | The prior report alleges a live token, but no alert ID, GitHub secret type/validity, exact line, or original match was accessible. |
| Verified synthetic value | **NOT ESTABLISHED** | The local candidate scan found opaque strings in several candidate blobs; it did not prove their provenance or link them to alert matches. |
| Verified false positive | **NOT ESTABLISHED** | The prior “false positive” decision depended on unverified path/line assumptions. |
| Historical exposure status | **UNRESOLVED** | The prior negative Git-history search and no-exposure conclusion are not accepted as proof about the unknown alert locations. |
| Revocation required | **YES, pending owner action** | Treat the alleged live credential as compromised. The GoCardless credential owner should identify and promptly revoke any active credential corresponding to the outstanding alert(s), rotate it, update authorized secret stores, and verify dependent integrations. No credential was accessed or changed here. |

Do not dismiss any matching GitHub alert unless its exact alert metadata and matching blob location have been reviewed and the provider credential has been shown to be synthetic, invalid, or otherwise safely resolved. If it is confirmed live, revoke it and follow the provider's incident-response process. If it is confirmed synthetic, document why the precise matched value cannot authenticate and then resolve through the authorized GitHub workflow.

## Corrective actions and next evidence needed

1. A repository security administrator should retrieve the original Secret Scanning alert records from GitHub Security using authorized read-only access. Capture alert IDs, exact repository, alert URL, secret type, state, validity, created/resolved status, source commit, and every location's path, start/end line, blob SHA, and commit SHA. Do not export or paste the secret value.
2. For each alert, compare the reported blob SHA to the blob at the reported commit and inspect only the matching location through a redacting workflow. Record whether the value is a real provider credential, a verified synthetic value, or unresolved; preserve the evidence trail.
3. Treat a live or uncertain GoCardless token as compromised and revoke/replace through the provider account owner. Update dependent secret stores without placing values in commands, logs, reports, or source control.
4. Review all relevant historical occurrences and repository clones after alert locations are known. Use exact-path/commit evidence; do not infer cleanliness from current files alone.
5. Keep secret scanning enabled. Do **not** add blanket `artifacts/**` exclusions. Improve artifact sanitization and test-data generation without hiding scan results.

## Actions taken in this investigation

- Attempted the GitHub connector's read-only fetch for the repository Secret Scanning alert collection; it rejected that endpoint as unsupported.
- Checked for an existing authenticated browser session; the browser host was unavailable. No login, token, or credential was used.
- Verified the local origin repository name and candidate commit SHA, then inventoried 28 candidate blob IDs from the prior report. No secret values were emitted.
- Replaced the unsupported false-positive, no-exposure, and no-revocation conclusions in this report with **PARTIAL / UNVERIFIED** findings.
- Did not edit application source, database, Docker configuration, credentials, Git history, alert state, or other uncommitted files. No commit, push, or merge was made.

## Addendum 2026-11-09: redacting full-object-database audit (follow-up session)

**Method.** All analyses were redacting: only pattern names, blob SHAs, path mappings, lengths, entropy, and SHA-256 prefixes of candidate values were emitted. No secret value, value prefix, or matching line was printed. No git object was modified and no alert was touched.

**Scope.** Every blob in the local object database of this clone (`git cat-file --batch-all-objects`), which covers all local branches, all remote-tracking branches (`origin/*`), and dangling objects: 3,005 blobs total. 2,989 blobs (<= 2 MB) were raw-byte scanned directly; the 16 blobs > 2 MB are all zip archives (8 tracked under `artifacts/`, 8 dangling) and were decompressed and scanned member-wise.

**Result table.**

| Check | Result |
|---|---|
| GoCardless token shape (`live_` + 40 chars), raw bytes, all blobs | **0 matches** |
| Generic `live_` prefix + 16–39 chars | **0 matches** |
| OpenAI / GitHub / AWS AKIA / Slack / Google API / JWT / Bearer shapes | **0 matches each** |
| The 28 candidate `artifacts/**/report.json` files at commit `5db536e7` | Parsed as JSON; 211 opaque strings found; **0 credential-shaped**; none appear in tracked source; worktree blobs byte-identical to commit blobs |
| DB URLs with embedded credentials (shape) | 45 blobs, all placeholder or **loopback-only test values** (hosts `127.0.0.1`, compose service `postgres`, `*.example.invalid`, `HOST/DATABASE`) |
| Credentials on any remote host (incl. `neon.tech`) | **0** |
| `backend/.env` (live Neon `DATABASE_URL`) | Gitignored; **never committed on any branch**; absent from the object database |

**Interpretation (local scope).** No GoCardless-shaped token — and no shape matching any known provider token format — exists anywhere in this clone's entire object database, reachable or dangling. The prior report's 28 candidate paths contain no value matching the alleged secret type at the candidate commit; the prior aggregate line references correspond to console error messages, map place titles/addresses, route-point labels, and output paths. The only credential-shaped strings in history are disposable loopback/compose test-database passwords that cannot authenticate against any remote system.

**Consequence for the GitHub alert.** If a GoCardless Live Access Token alert is outstanding for this repository, its matching blob is not present in this clone. That leaves, locally indistinguishable: (a) pushed content from a different clone/machine that was later rewritten or pruned locally, or (b) a different repository entirely. Only the GitHub Security UI alert metadata (alert ID, repository, state, validity, per-location blob/commit SHAs) can decide between these.

**Status change.** Local-repository component of the investigation is now **VERIFIED CLEAN (this clone, full history, all refs, dangling included)**. Overall status remains **PARTIAL / UNVERIFIED** until the GitHub-side alert records are captured, because local cleanliness cannot rule out exposure via a different clone. The provider-side revocation guidance is unchanged, but local evidence now weighs strongly against this repository having been the exposure vector.
