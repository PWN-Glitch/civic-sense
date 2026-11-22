# Civic Sense

Civic Sense is licensed under the [MIT License](LICENSE).

Civic Sense is an Android mobile app and FastAPI backend for reporting neighborhood infrastructure problems (potholes, broken streetlights, trash and illegal dumping, graffiti, damaged sidewalks, and other street hazards) to local government channels and tracking what happens next.

A resident photographs an issue, reviews an AI category suggestion with its confidence score, confirms or overrides the category, places a GPS pin, and picks an official reporting channel from a curated contact registry. When a city offers no public write API, Civic Sense composes an editable submission for the city's web form, email address, or 311 phone line and records delivery separately from repair status: only an upstream API confirmation marks a report `submitted`, while user-sent forms, emails, and calls record `status_unknown` ("sent by you, status unknown").

## How It Works

1. **Capture & classify:** `mobile/` captures a photo (`expo-camera` or photo library), resizes/re-encodes it (`expo-image-manipulator`), and runs an on-device MobileNetV3-Small TFLite model (`react-native-fast-tflite`) when cached locally. If the local model is absent, classification falls back to `POST /classify` (MobileNetV3 ONNX Runtime when exported, otherwise zero-shot OpenCLIP `ViT-B-32`, or HTTP `503` manual category selection).
2. **Human confirmation & location:** The user confirms or changes the category (`pothole`, `streetlight`, `trash`, `graffiti`, `sidewalk damage`, `other`) and adjusts a foreground GPS pin on a MapLibre + OpenStreetMap raster map. No background location permission is requested.
3. **Pre-flight duplicate check:** Before creating a new record, `GET /reports/duplicates` queries PostGIS `ST_DWithin` for reports of the same category within 25 meters filed in the last 30 days. Any signed-in user can attach a photo they uploaded to an existing report instead of filing a duplicate.
4. **Routing & channel resolution:** `POST /contacts/resolve` matches coordinates against bounding-box adapters (`Baltimore` 311/SeeClickFix deep links, `Chicago` Open311 GeoReport v2, `Bloomington` Open311 GeoReport v2, or a `usa.gov` fallback) and ranks channels from `contacts.json` by jurisdiction match, category coverage, verification status, and verification recency. Unverified registries fall back to official portal URLs rather than invented contacts.
5. **Upload hardening & server-side privacy processing:** `BodySizeLimitMiddleware` rejects HTTP bodies above `10 MB + 64 KB` with `413` before multipart spooling. `POST /media` enforces a 10 MB file cap, JPEG/PNG magic-byte sniffing, and Pillow decompression-bomb checks, re-saves images without EXIF or ICC metadata under a server-generated UUID filename (`uploader_id` recorded on `photos`), and runs server-side face blurring (`egoblur` CLI if present on `PATH`, then OpenCV frontal-face Haar cascade, else an explicit no-op). Non-owner reads apply a deterministic coordinate offset of up to ~50 meters (see [Privacy & Security Limitations](#known-limitations)).
6. **Idempotent retries, offline queue & tracking:** `POST /reports` accepts a client-generated `client_ref` UUID (`uq_reports_reporter_client_ref`) so network retries and offline replays return the existing report rather than filing duplicates. When offline, `mobile/` persists draft progress (`client_ref`, `photo_id`, `report_id`) in `expo-sqlite` and resumes on reconnect. Case files separate delivery events (`GET /reports/{id}/events`) from official repair status (`Draft` -> `Confirmed` -> `Submitted` -> `Acknowledged` -> `InProgress` -> `Resolved`). Neighbors can cast one advisory verification vote per report (`still_present`, `appears_fixed`, `not_sure`), which never changes the official status.

## Repository Layout

- `mobile/`: Expo SDK 57 / React Native 0.86 Android client (TypeScript, MapLibre Native, `react-native-fast-tflite`, `expo-sqlite`, `expo-secure-store`, Zustand). Authenticates via a silent per-install credential stored in `expo-secure-store` (`POST /auth/register` and `POST /auth/login`).
- `server/`: Python 3.12 FastAPI modular monolith, async SQLAlchemy 2 + `asyncpg`, GeoAlchemy2, Alembic migrations, and ONNX / OpenCLIP inference services.
- `docker-compose.yml`: PostgreSQL 16 + PostGIS 3.4 container bound to host loopback (`127.0.0.1:5433:5432`).
- `docs/`: [docs/CAC_SUBMISSION.md](docs/CAC_SUBMISSION.md) (Congressional App Challenge package) and [docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md) (AI assistance disclosure). Backend threat model and dependency audit notes live in [server/SECURITY.md](server/SECURITY.md).

## Prerequisites

- **Docker & Docker Compose** (runs `postgis/postgis:16-3.4` bound to `127.0.0.1:5433`)
- **Python 3.12** (`server/pyproject.toml` requires `>=3.12,<3.13`)
- **Node.js & npm** (verified with Node 26 / npm 12; Node 20+ LTS works)
- **Android Studio / Android SDK + JDK** with an Android emulator or USB-debugging Android device. **Expo Go is not supported:** `react-native-fast-tflite` and `@maplibre/maplibre-react-native` require a native build (`npx expo run:android`).

## Setup & Running Locally

### 1. Start PostgreSQL + PostGIS

From the repository root:

```bash
docker compose up -d db
```

Wait until `docker ps` shows `civicsense_db` as `(healthy)` on `127.0.0.1:5433->5432/tcp` (loopback only, not exposed on LAN interfaces; re-running `docker compose up -d db` recreates any older `0.0.0.0:5433` container on loopback while preserving the `pgdata` volume).

### 2. Configure, migrate, and start the backend (`server/`)

```bash
cd server
python3.12 -m venv .venv
. .venv/bin/activate

# Optional on Linux x86_64: install CPU-only PyTorch wheels first to avoid ~2.5 GB CUDA downloads
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

pip install -e ".[ai,dev]"
cp .env.example .env
```

Generate a real `JWT_SECRET` and write it into `server/.env`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Replace `JWT_SECRET=dev-secret-change-me` in `server/.env` with that output. `app/config.py` validates startup settings at import time (including during `alembic`) and refuses to boot with `RuntimeError` if:

- `DEV_AUTH_BYPASS=false` while `JWT_SECRET` is still `dev-secret-change-me`, or
- `DEV_AUTH_BYPASS=true` while `APP_ENV=production` (the default).

Apply database migrations through `0007_report_client_ref` and seed the verified-contact registry:

```bash
alembic upgrade head
python -m scripts.seed_contacts
```

> **Required database migrations (`0006` / `0007`):** Deploying or running this backend against an existing database **requires** `alembic upgrade head` first (`0006_photo_uploader` adds `photos.uploader_id`; `0007_report_client_ref` adds `reports.client_ref` and unique index `uq_reports_reporter_client_ref`). Without them, media uploads and report queries fail with missing-column SQL errors. Existing `photos` rows created before `0006` keep `uploader_id = NULL`: photos already attached to reports remain attached and readable, while unattached pre-`0006` rows cannot be attached to any report (`403`).

> **Do not run `scripts.seed_demo` on existing databases:** Normal setup needs only `scripts.seed_contacts` (which ensures jurisdiction rows and upserts `app/data/contacts.json`). `python -m scripts.seed_demo` deletes every `users` row whose `google_sub` starts with `demo-` along with their cascaded reports, verifications, and `photos` database rows, **without** deleting the underlying image files in `UPLOAD_DIR`. Files without a matching photo row are not served, but remain on disk.

Start the API server:

```bash
# Localhost (for Android emulator or USB adb reverse in debug builds):
uvicorn app.main:app --host 127.0.0.1 --port 8000

```

Verify with `curl http://127.0.0.1:8000/health` (returns `{"status":"ok"}`). If port `8000` is occupied on your machine, choose another port (for example `--port 8001`) and set `EXPO_PUBLIC_API_URL` to match when bundling the mobile app.

For USB development, keep the computer running and the phone connected.
For wireless use, the standalone build can use the private HTTPS connection
described below without USB or Metro.

### 3. Build and run the Android app (`mobile/`)

Expo inlines `EXPO_PUBLIC_API_URL` at JavaScript bundle time (`mobile/src/api/client.ts`). When unset, it defaults to `http://10.0.2.2:8000` (the Android emulator's alias for host `127.0.0.1:8000`).

- **Debug builds (`__DEV__ === true`):** Local `http://` URLs are allowed for development (`10.0.2.2`, `127.0.0.1` via `adb reverse`, or LAN HTTP).
- **Release builds (`__DEV__ === false`):** HTTPS is required. `assertSecureTransport` in `mobile/src/api/client.ts` rejects any non-`https://` `EXPO_PUBLIC_API_URL` (private LAN/VPN and loopback addresses included), and `./plugins/withCleartextTraffic.js` removes `android:usesCleartextTraffic` from the main manifest, writes `android/app/src/release/` with `<base-config cleartextTrafficPermitted="false" />`, and adds a Gradle `preReleaseBuild` check that aborts release builds unless `EXPO_PUBLIC_API_URL` is a valid `https://` URL. If `mobile/android/` was generated by an earlier build, back up any native changes and run `npx expo prebuild` before building a release binary to apply the updated configuration.

```bash
cd mobile
npm install
```

Choose the debug command matching how your Android target reaches the host:

- **Android emulator** (backend on host port `8000`):
  ```bash
  npx expo run:android
  ```
- **Physical Android phone over USB** (backend on `127.0.0.1:8000`):
  ```bash
  adb reverse tcp:8000 tcp:8000
  adb reverse tcp:8081 tcp:8081
  EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npx expo run:android
  ```

Debug APKs normally load JavaScript from Metro, so keep it running while using
the app. If you start it separately for USB, run
`EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npx expo start --localhost`.
If you change `EXPO_PUBLIC_API_URL` later, restart Metro with `--clear` so the
bundle picks up the new value. For wireless or release builds, terminate TLS
in front of `uvicorn` and bundle with an `https://` `EXPO_PUBLIC_API_URL`.

#### Wireless Android setup with Tailscale

Connect both the computer and phone to the same Tailscale network and enable
MagicDNS and HTTPS for that network. Keep the API bound to loopback and turn
off `DEV_AUTH_BYPASS`. For the local service on port 8001, expose it only to
the tailnet:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8001
tailscale serve status
```

Use the HTTPS address shown by `tailscale serve status` to build a standalone
APK. The phone must have Tailscale connected to reach it, and the computer must
remain on. This sample uses the project's generated debug signing key, so it
is for personal testing, not distribution:

```bash
cd mobile/android
EXPO_PUBLIC_API_URL=https://<computer-tailnet-name>:8443 NODE_ENV=production \
  ./gradlew :app:createBundleReleaseJsAndAssets --rerun :app:assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

The explicit bundle task rebuilds JavaScript when the API URL changes. A
release signed with a different key cannot replace the installed app; back up
its data before changing signing keys or uninstalling it.

### 4. Optional: Train and export classifier artifacts

Model binaries under `server/app/models_store/` (`*.pt`, `*.onnx`, `*.tflite`, `*.json`) are gitignored. Without them, `GET /models/civic-classifier.*` returns `404` (disabling on-device TFLite inference) and `POST /classify` uses OpenCLIP `ViT-B-32` on CPU if `.[ai]` is installed, or returns `503` so the app prompts for manual category selection.

To train the bootstrap MobileNetV3-Small checkpoint (`app/models_store/mobilenet_civic.pt`) *(script execution not re-verified during this documentation pass)*:

```bash
cd server
. .venv/bin/activate
python -m scripts.train_classifier
```

To export `civic-classifier.onnx`, `civic-classifier.tflite`, and `civic-classifier.json`, use a **separate** Python 3.12 virtualenv (`onnx2tf` pins older `onnx` and `setuptools` versions that conflict with the serving environment; see [server/SECURITY.md](server/SECURITY.md)). `scripts/export_tflite.py` inspects the exported `.tflite` flatbuffer with `tf.lite.Interpreter` and writes its actual `input.shape` and `layout` (`NHWC` or `NCHW`) into `civic-classifier.json` automatically *(script execution not re-verified during this documentation pass)*:

```bash
cd server
python3.12 -m venv .venv-export
. .venv-export/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -e ".[ai,train]"
python -m scripts.export_tflite
```

## Configuration

### Backend (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://civicsense:civicsense@localhost:5433/civicsense` | Primary async PostgreSQL + PostGIS connection URL |
| `TEST_DATABASE_URL` | `postgresql+asyncpg://civicsense:civicsense@localhost:5433/civicsense_test` | Dedicated disposable PostGIS database dropped and truncated by `pytest` |
| `APP_ENV` | `production` | `development`, `test`, or `production`. `DEV_AUTH_BYPASS=true` is rejected when `APP_ENV=production` |
| `JWT_SECRET` | `dev-secret-change-me` | HS256 signing secret (7-day token TTL). Must be replaced whenever `DEV_AUTH_BYPASS=false` |
| `DEV_AUTH_BYPASS` | `false` | Development/test-only flag allowing `POST /auth/google` with `{"id_token":"dev"}`. Refused in `production` |
| `GOOGLE_CLIENT_ID` | `""` | Expected audience for `POST /auth/google` (unused by the mobile app's default device-credential flow) |
| `UPLOAD_DIR` | `./uploads` | Local directory storing EXIF-stripped, UUID-named media uploads |

### Mobile (`mobile/`)

| Variable | Default | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://10.0.2.2:8000` | Backend base URL inlined at Metro bundle time (`http://` allowed in debug only; release builds require `https://`) |

## Running Tests

### Backend (`pytest`)

> **Data-loss warning:** `server/tests/conftest.py` runs `Base.metadata.drop_all` / `create_all` at session start and executes `TRUNCATE ... RESTART IDENTITY CASCADE` across every table after each test. `TEST_DATABASE_URL` **must** point to a dedicated, disposable PostGIS database (`civicsense_test`) and **never** to `DATABASE_URL` or any database holding real data.

On a fresh `civicsense_db` container, create the dedicated test database once:

```bash
docker exec civicsense_db createdb -U civicsense civicsense_test
```

*(If `civicsense_test` already exists, `createdb` exits with `database "civicsense_test" already exists`; skip straight to `pytest`.)*

Run the backend test suite:

```bash
cd server
. .venv/bin/activate
pytest
```

### Mobile (`jest` + TypeScript)

```bash
cd mobile
npm test -- --watchAll=false
npx tsc --noEmit
```

## API Overview

All endpoints except `GET /health`, `GET /stats/impact`, `GET /models/*`, `GET /media/{key}`, and `/auth/{register,login,google}` require an `Authorization: Bearer <jwt>` header.

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me`
- **Classification & models:** `POST /classify` (`?engine=mobilenet|clip`), `GET /models/civic-classifier.json`, `GET /models/civic-classifier.tflite`
- **Media:** `POST /media`, `GET /media/{uuid}.{jpg|png}`
- **Routing & contacts:** `POST /routing/resolve`, `POST /contacts/resolve`, `GET /contacts`
- **Reports & composition:** `POST /reports`, `GET /reports/mine`, `GET /reports/duplicates`, `GET /reports/{id}`, `PATCH /reports/{id}`, `DELETE /reports/{id}`, `POST /reports/{id}/photos`, `POST /reports/{id}/compose`, `POST /reports/{id}/compose/regenerate`, `GET /reports/{id}/draft`, `PATCH /reports/{id}/draft`, `POST /reports/{id}/submission`, `GET /reports/{id}/events`
- **Verification, map & stats:** `POST /reports/{id}/verify`, `GET /reports/{id}/verifications`, `GET /map/issues`, `GET /stats/impact`, `GET /health`

## Known Limitations

- **Map resources:** The basemap uses OpenStreetMap tiles and cluster counts use
  MapLibre's demo glyph server. Both require network access; the glyph server
  receives the device's IP address and may not be suitable for production use.
- **Bootstrap classifier training data:** `train_classifier.py` trains MobileNetV3-Small on procedurally generated synthetic images (`scripts/synthetic_data.py`) plus any optional local photos placed under `server/data/seed_images/<category>/`. Real-world photo accuracy is limited unless retrained on field imagery, so every prediction displays its confidence score and requires user confirmation.
- **Jurisdiction coverage and Baltimore 311 status:** Only Baltimore, MD (SeeClickFix / `baltimorecity.gov/311` web deep links + `311` phone), Chicago, IL (Open311), and Bloomington, IN (Open311) have bounding-box adapters and seeded contacts; other locations fall back to `usa.gov/local-governments`. Because Baltimore's Open311 API is offline, Baltimore reports require manual submission on the city portal, and post-submission status transitions (`Acknowledged`, `InProgress`, `Resolved`) rely on user-logged updates on the Case File screen rather than live city webhooks. Several UI labels (`Impact` header and `Settings` "Filed to" row) remain hardcoded to Baltimore copy.
- **Privacy, media access, and blurring boundaries:**
  - **EXIF & face/plate blurring:** Authoritative EXIF/ICC stripping runs server-side in `strip_exif()` before writing to `UPLOAD_DIR`. Face blurring (`blur_sensitive()`) also runs server-side after upload (not on-device prior to upload): without an external `egoblur` binary on `PATH`, it falls back to OpenCV's `haarcascade_frontalface_default.xml`, which blurs detected frontal faces only, does not blur license plates or non-frontal faces, and becomes a silent no-op (`blurred: false`) if OpenCV/cascades are absent.
  - **Capability media URLs & orphaned files:** `GET /media/{uuid}.{jpg|png}` requires no bearer token so React Native `<Image>` can load report photos; anyone with the UUID URL can read a file while its photo row exists. `DELETE /reports/{id}` unlinks attached files when unreferenced by other `Photo` rows, but abandoned unattached uploads (`POST /media` without report creation) and files whose DB rows were wiped by `scripts.seed_demo` remain on disk in `UPLOAD_DIR` until removed manually. Files without a photo row are not served. Pre-`0006` legacy `photos` rows have `uploader_id = NULL`: already-attached report photos keep working, while unattached pre-`0006` rows cannot be attached.
  - **Coordinate jitter is non-cryptographic:** Non-owner reads (`GET /map/issues`, `GET /reports/{id}`, `GET /reports/duplicates`, and `POST /reports` `possible_duplicates`) offset stored coordinates by up to ~50 m (`0.00045°`) using an unkeyed SHA-256 hash of the public `report.id` (`app/services/jitter.py`). This prevents casual doorstep pinpointing on the map, but the offset is reversible given `report.id`.
- **Single-worker rate limiting and local disk storage:** `app/middleware/ratelimit.py` stores sliding-window counters in process memory (resetting on restart and not shared across multiple workers), and uploaded media lives on local disk (`UPLOAD_DIR`) rather than object storage.
- **Build limits:** A release-mode Android APK signed with the debug key was tested against a private HTTPS server. It is not signed for distribution. iOS and web builds have not been verified.
