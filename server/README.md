# Campus WebGIS Phase 7 server

Java 21 / Spring Boot 4.1.1 / PostgreSQL 16.4 / PostGIS 3.4.3. The backend stores campus business geometries in EPSG:32650 and sends GeoJSON longitude/latitude in EPSG:4326. The Phase 1–6 map rendering GeoJSON and GLB remain separate, read-only frontend assets.

## Local startup (PowerShell)

From the project root (with the separately licensed campus data restored):

```powershell
$env:DB_PASSWORD = '<choose-a-local-password>'
docker compose -f database/docker-compose.yml up -d
$env:CAMPUS_DATA_ROOT = (Get-Location).Path
$env:CAMPUS_IMPORT_ON_START = 'true'
cd server
.\mvnw.cmd spring-boot:run
```

The first startup runs Flyway V1–V4 and imports the authoritative EPSG:32650 sources. Repeated imports are transactional upserts and preserve the Phase 2 stable IDs. Set `CAMPUS_IMPORT_ON_START=false` on later starts if no reimport is needed. The database is bound only to `127.0.0.1:5433`; server defaults to `127.0.0.1:8080`. See `.env.example` for variable names. Never commit a real password.

Profiles: `dev` enables repeatable import by default, `test` imports in integration tests, `prod` disables automatic import and health detail. Select with `SPRING_PROFILES_ACTIVE`. This is not a production deployment.

## Tests and package

With the local Compose PostGIS running and `DB_PASSWORD` and `CAMPUS_DATA_ROOT` set:

```powershell
.\mvnw.cmd test
.\mvnw.cmd package
```

Integration tests use the real PostGIS Compose database, not H2. They verify Flyway, repeatable import, CRS, spatial predicates, search, REST validation, and error status. Testcontainers is not used in Phase 7 because the same fixed PostGIS service is already available; the test prerequisite is explicit.

## API

- `GET /actuator/health`
- `GET /api/v1/features` (`type`, `category`, WGS84 `bbox`, `businessOnly`, `limit`)
- `GET /api/v1/features/{id}`, `/search?q=`, `/layers`, `/stats/overview`
- `POST /api/v1/analysis/{nearby,nearest,within,intersection,buffer,distance,area}`

`/features` returns a `CampusFeatureCollection` DTO, not a strict RFC GeoJSON FeatureCollection. Each record has a standard WGS84 GeoJSON `geometry` plus business metadata. All coordinate inputs to analysis APIs are `[longitude,latitude]` in EPSG:4326. Distances and areas are measured after transforming to EPSG:32650.

Web frontend:

```powershell
cd ..\web
$env:VITE_FEATURE_SOURCE = 'api'
npm run dev
```

Vite proxies `/api` to port 8080. Set `VITE_FEATURE_SOURCE=static` for the explicit Phase 6 rollback path. API mode never silently falls back.
