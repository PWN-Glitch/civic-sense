# Security notes: Civic Sense server

Scope: the FastAPI backend in `server/`. Client-side / Expo concerns live with
the mobile app.

## Rate limiting

Sliding-window, in-memory, per-process (`app/middleware/ratelimit.py`).

| Route                          | Limit  | Key            |
|--------------------------------|--------|----------------|
| `POST /auth/google`            | 10/min | source IP      |
| `POST /auth/register`          | 10/min | source IP      |
| `POST /auth/login`             | 10/min | source IP      |
| `POST /media`                  | 20/min | user id        |
| `POST /classify`               | 20/min | user id        |
| `POST /reports`                | 30/min | user id        |
| `POST /reports/{id}/verify`    | 10/min | user id        |

Exceeded → `429 {"detail":"rate limit exceeded","retry_after":N}` plus a
`Retry-After: N` header.

In-memory is the right call for the MVP because we ship a single uvicorn
worker and don't want to run Redis just for this. When we scale beyond one
process, swap `RateLimiter` for a Redis-backed implementation; the public
interface (`hit()` / `reset()` and the dependency factories) is stable, so
call sites don't change.

## Upload pipeline hardening

Every request body is capped at 10 MB + 64 KB by `BodySizeLimitMiddleware`
(`app/middleware/bodylimit.py`), before anything parses it: a larger
`Content-Length` is refused outright and a chunked body is counted as it
arrives. Without it, Starlette would spool a multipart upload of any size to a
temp file before the route ran.

`/media` and `/classify` then both enforce, in order:

1. **Size cap:** 10 MB, read with a bound so an oversized file never lands in
   memory whole.
2. **Content-Type header** sanity check (media only; classify sniffs bytes).
3. **Magic-byte sniffing:** actual JPEG (`FF D8 FF`) or PNG
   (`89 50 4E 47 0D 0A 1A 0A`) signature must match the declared type. This
   defeats the classic "shell.php renamed .jpg" attack because the header
   lies but the bytes don't.
4. **Pillow decode:** `Image.open` + `img.load()`. Pillow's
   `MAX_IMAGE_PIXELS` (≈89 MP) catches decompression bombs; we surface that
   as HTTP 413.
5. **EXIF strip:** image is re-saved without `exif` / `icc_profile` /
   `info`, so GPS and camera metadata never persist to disk. Verified by
   `tests/test_upload_hardening.py::test_media_gps_exif_removed` which
   asserts the stored file has an empty EXIF dict and no "TestMake" bytes.
6. **Filename:** stored files are named `<uuid4>.<ext>`. The client's
   `UploadFile.filename` is never used as a filesystem path component, so
   path-traversal via filename is impossible by construction.

## Secrets

`.env` is gitignored. `.env.example` documents every variable with no real
values.

**Fail-fast rules:** `config.py` refuses to boot with `RuntimeError` if

- `DEV_AUTH_BYPASS=true` while `APP_ENV` is `production`. `APP_ENV` defaults
  to `production`; only an explicit `development` or `test` allows the bypass,
  which accepts the literal id_token `"dev"` on `POST /auth/google`.
- `DEV_AUTH_BYPASS=false` and `JWT_SECRET` is the in-tree dev placeholder
  (`"dev-secret-change-me"`).

Together these mean a production deploy can neither skip Google verification
nor sign with a public secret by accident. With the bypass on in a dev/test
environment the placeholder secret is still accepted, so tokens there are
forgeable by anyone who reads this repo: never expose such a server. The
checks run at import time, before any route is registered.

## Dependency audit: pip-audit

Run: `. .venv/bin/activate && pip-audit`.

### Resolved (2026-10-08)

| Package    | Was    | Now    | Notes                                    |
|------------|--------|--------|------------------------------------------|
| onnx       | 1.20.1 | 1.23.2 | 8 CVEs incl. path-traversal & heap-read  |
| pytest     | 9.0.2  | 9.1.1  | /tmp world-writable test dirs            |
| setuptools | 81.0.0 | 84.0.0 | MANIFEST.in exclude-bypass               |

The `train` extra (`onnx2tf`) pins the older `onnx==1.20.1`, `pytest==9.0.2`,
`setuptools==81.0.0`. Training runs in a SEPARATE venv from serving; do not
mix `pip install -e '.[train]'` into the runtime environment.

### Resolved (2026-11-21)

Checked against a clean `pip install .` of the server (no extras) and the
existing dev venv, with `pip-audit -r <freeze> --no-deps --disable-pip`.

| Package           | Was       | Now        | Notes                                         |
|-------------------|-----------|------------|-----------------------------------------------|
| pillow            | 12.3.0    | 13.0.0     | 14 image-decoding advisories; `pyproject.toml` floor raised to `>=13.0` |
| pyasn1            | 0.6.4     | 0.6.5      | via python-jose → rsa; a clean install already resolves 0.6.5 |
| certifi           | 2026.7.22 | 2026.11.20 | dev venv only; clean install already current  |
| dnspython         | 2.9.0     | 2.9.2      | dev venv only; clean install already current  |
| opentelemetry-api | 1.45.1    | 1.45.2     | dev venv only; clean install already current  |

The base install also no longer imports numpy at startup (it ships with the
`ai` extra), so `pip install .` without extras boots and `/classify` answers
503 with `fallback: true` instead of the server failing to import.

### Accepted risk (no fix available)

**`python-jose 3.5.0`, CVE-2026-85394 / PYSEC-2026-4298** (GHSA-3qf3-8w2g-rqmx).
The bug is in HMAC initialization accepting DER-encoded *public keys* lacking
PEM armor. Our usage is HS256 symmetric signing with a server-held secret
string (`settings.jwt_secret`); we never pass an asymmetric key into jose's
HMAC path, and `app/security.py` decodes with `algorithms=["HS256"]`
explicitly. The vulnerable code path is unreachable in our usage. Mitigation:
monitor for a fixed release; if we ever switch to RS256/ES256, revisit.

**`ecdsa 0.19.2`, PYSEC-2026-1325 / CVE-2024-23342** (Minerva timing
attack on P-256 signing). Transitive via `python-jose[cryptography]`. We do
NOT use ECDSA for JWT (HS256 only). The vulnerable `SigningKey.sign_digest`
code path is unreachable. Same mitigation: monitor, revisit if algorithm
choice changes.

**`torch 2.14.1+cpu` / `torchvision 0.29.1+cpu`**: pip-audit skips these
("dependency not found on PyPI") because they were installed from the
PyTorch CPU index. Accepted risk: they are only loaded by the CLIP classifier
for local inference, never exposed to the network directly, and run inside
the server process. Upgrading means waiting on the PyTorch CPU index to
publish patched builds; we accept this for the local-ML demo. If we move
classification to a hosted service, these deps go away entirely.

**Optional extras and tooling, not the base server.** In a dev venv that
also has the `ai`/`train` extras, pip-audit still flags `filelock 3.32.3`
(pulled in by torch and huggingface_hub; fixed in 4.x) and `setuptools
84.0.0` (build tooling; fixed in 84.1.0). Neither is in a base install.
`onnx2tf` pins conflicting versions, which is why training needs its own venv.

### Mobile (npm)

`npm audit --omit=dev` on `mobile/package-lock.json`, 2026-11-21: a lock-only
`npm audit fix` (no `package.json` change, `expo` 57.0.27 and react-native
0.86.3 unchanged) moved patch releases of Expo's build tooling plus
`follow-redirects` 1.16.1 → 1.16.3, `node-forge` 1.4.0 → 1.4.3 and `glob`
13 → 14 inside `@expo/cli`. That cleared 4 high and 4 moderate advisories.

**Still open, 4 moderate:** `minimatch` 7.0.0–11.0.0 (GHSA-g3hv-75wg-m249,
pattern-expansion DoS), reached only through `@expo/fingerprint`, which `expo`,
`@maplibre/maplibre-react-native` and `@expo/fingerprint` itself are flagged
for. npm's only offered fix downgrades to Expo 52. `@expo/fingerprint` hashes
project files at build time; the pattern input is the project's own, not user
input, and none of it ships in the app bundle.

## Repository secret sweep

Last run 2026-10-08. Commands and findings:

```
grep -riE "api[_-]?key|secret|password" --include=*.py .
```

All hits reviewed by hand. They are: settings field NAMES (`jwt_secret`),
the placeholder string `"dev-secret-change-me"` (intentionally public;
it's the canary we fail-fast on), test fixtures minting throwaway tokens,
and docstrings. No real secrets, API keys, or passwords in code.

```
grep -rE "BEGIN (RSA|EC|OPENSSH|PRIVATE)" .
```

No private keys committed.

`.env` and `*.pem` / `*.key` are gitignored at the repo root.

## Threat model snapshot (for reviewers)

- **Auth:** the app provisions a per-device email/password account
  (`/auth/register`, `/auth/login`, bcrypt hashes). Google `id_token`s are
  verified server-side via Google's `tokeninfo` endpoint, audience-checked
  against `GOOGLE_CLIENT_ID`. Either way the server issues its own HS256 JWT
  (7-day TTL). The dev bypass is described under "Secrets".
- **Authorization:** `PATCH` and `DELETE /reports/{id}` are owner-only (403
  otherwise). Any signed-in user may attach a photo to any report (that is how
  a neighbour adds evidence), but only a photo they uploaded themselves
  (`photos.uploader_id`); an attached photo can be re-sent with the same kind
  but not relabelled (409). Verification votes are one-per-user via Postgres
  upsert on `(user_id, report_id)` unique key. `POST /reports` accepts a
  per-reporter `client_ref`, so a replayed create returns the first report.
- **Input validation:** Pydantic schemas with `Field(ge=, le=, pattern=)`
  on lat/lng/category. SQLAlchemy everywhere; no string-concatenated SQL.
- **Uploads:** see "Upload pipeline hardening" above.
- **Privacy:** EXIF stripped server-side; faces/plates blurred (EgoBlur →
  OpenCV Haar → explicit no-op); everyone but the reporter sees coordinates
  moved by a fixed per-report offset of up to ~50 m, on the map, the
  single-report read and both duplicate checks.
- **Transport (mobile):** release builds are HTTPS-only. Gradle's
  `preReleaseBuild` fails unless `EXPO_PUBLIC_API_URL` is an `https://` URL,
  the release network security config permits no cleartext host, and the app
  refuses to attach its token to a non-HTTPS request outside `__DEV__`. Debug
  builds allow HTTP for local development.

## Known privacy limitations

- **Photo URLs are capability URLs.** `GET /media/<uuid>.jpg` needs no token
  (React Native's `<Image>` cannot send one). Anyone holding a URL can fetch
  the photo, including an upload not yet attached to any report. A file is
  served only while a `photos` row references it, so a deleted report or a
  wiped demo user stops serving its photos. Files that lose their row are not
  deleted from disk; `DELETE /reports/{id}` removes its own files, other
  deletions (such as `scripts.seed_demo` wiping demo users) leave them in
  `UPLOAD_DIR`.
- **Blurring is best effort.** OpenCV Haar misses angled or small faces and
  plates; without the `ai` extra there is no blurrer at all and photos are
  stored unblurred (`blurred: false` in the upload response). EXIF is always
  stripped.
- **The duplicate check can locate a report.** `GET /reports/duplicates`
  matches against the exact stored point within 25 m. A signed-in user who
  probes many points can narrow a report down past the ~50 m offset. The
  endpoint has no rate limit.
- **Exact coordinates are stored.** The offset is applied when reading; the
  database, backups and the reporter's own views hold the exact point.
- **Limits are per process.** Rate limits live in memory, so restarting or
  running several workers resets or splits them.
- **Rate limiting:** see above.
