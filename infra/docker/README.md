# Phase 8 production Compose

> Public-source note: these are deployment templates and historical tooling, not the private live installation. Campus model/GIS inputs and real `.env`/TLS files are deliberately absent. Restore authorized inputs before building containers. Version-specific `deploy-*` / cleanup scripts have exact old release guards; review them rather than running them as a current update command. The already-deployed site is https://ncstgeo.cn/ and is not changed by cloning this repository. Public operational guidance is in [../README.md](../README.md); the referenced production runbook below is a private, untracked installation record.

Run from the project root. Copy `infra/docker/.env.example` to `infra/docker/.env` on the server, replace the database password with a long random value, and keep `.env` private (`chmod 600`). Do not put the value in a command or commit. `infra/scripts/deploy.sh` builds two immutable release-tagged images, starts PostGIS, then backend, then Nginx, and validates the public HTTP path. This initial configuration is HTTP-only while the domain is pending approval. Do not call it HTTPS-complete.

Services use two networks: PostGIS is only on the internal `database_net`, backend bridges it to `edge_net`, and only Nginx publishes a host port. Neither PostgreSQL 5432 nor backend 8080 is published. PostgreSQL uses a named data volume. Container JSON logs rotate at 10 MB × 3.

The backend image contains exactly the campus source GIS files required by its idempotent importer. The web image contains the production Vite build and the unchanged v005 GLB. No Vite dev server or Maven cache is present in runtime images. The initial import may run on startup; it uses stable-ID upserts and does not duplicate rows. Set `CAMPUS_IMPORT_ON_START=false` after first validated deployment if source data is unchanged.

Domain/HTTPS setup, backup, restore and rollback procedures are in `../PRODUCTION_RUNBOOK.md`. Never publish the service before checking the provider security group and host firewall; especially ensure ports 5432 and 8080 are not exposed by existing host processes.
