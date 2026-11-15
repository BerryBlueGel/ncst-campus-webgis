# Deployment source and templates

The online demonstration is already hosted at [ncstgeo.cn](https://ncstgeo.cn/). Publishing these files does not deploy or update it.

## Included

- `docker/`: Compose templates and placeholder-only environment example. Only Nginx publishes ports; backend/PostGIS use internal networking.
- `nginx/`: HTTP/HTTPS and build configuration. Domain names and certificate mount paths are public configuration, not the certificates or private keys.
- `scripts/`: deployment, health checks, backup/verification restore, certificate renewal, rollback and scoped cleanup source.
- `systemd/`: certificate-renewal timer/service examples. Their paths assume the original Snap Docker installation and must be adapted for another host.

## Not included

Real `.env`, TLS/account material, database dumps/volumes, release archives/images, previous-source checkpoints and `PRODUCTION_RUNBOOK.md` are private or generated and remain untracked. Campus models and GIS data are separate authorized inputs. Dockerfiles refer to some of those inputs; a source-only clone cannot build the complete runtime image until they are supplied.

## Read before executing

Deployment/cleanup scripts are executable source, not a recommendation to run all scripts. Historical release scripts contain exact old-image/hash/path guards. Never remove guards simply to make an old release script run against a new environment. Cleanup permanently removes only its listed generated artifacts, so always preview where supported and retain rollback assets. `restore-db.sh --verify` restores to a temporary verification database rather than overwriting production. No operational job was executed as part of the GitHub source publication.

Supply credentials through a private environment file, not command arguments or Git. Initial HTTPS certificate enrollment requires an authorized domain and DNS pointing to the host; actual certificate files are never published here.
