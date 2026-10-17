# Source-only distribution

This repository intentionally does not distribute the campus datasets or production installation.

## Separately supplied inputs

- `web/public/data/`: generated GIS layers, feature catalog and metadata.
- `web/public/models/`: runtime campus GLB assets.
- `geojson/`, `reference/`, `output/`, `blender/`: authoritative geometries, imagery and modeling work files.
- `web/src/gis/three/*Manifest.json`: generated campus model bindings/geometry manifests.
- Campus-specific modules listed under the parameter/geometry section of `.gitignore`: manually traced shapes, roof groups, building names and presentation parameters. These are data even when encoded in TypeScript.
- `web/scripts/` and modeling scripts: excluded because historical generators contain embedded campus measurements or dataset-derived coordinates.

Restore these files only from authorized, separately maintained inputs. Do not substitute fabricated campus geometry just to make a build pass. The frontend imports several of these files at compile time, so a full production build and data-dependent tests require them. Generic source code and tests are published for study, not as a complete redistributable campus asset bundle.

The Java backend source, Flyway schema migrations, Maven wrapper and local PostGIS Compose template contain no database rows. It requires an externally supplied data root for import and a `DB_PASSWORD` supplied by the operator; no credential is included.

## Local checks

```sh
cd web
npm ci
npx tsx --test tests/brand-icons.test.ts tests/site-discovery.test.ts tests/camera-sync.test.ts
```

Check available test filenames before running individual tests. Run `npm test` and `npm run build` only after restoring the licensed local inputs. Full-project results reported for the production workspace are not a claim that this data-free repository alone reproduces the online campus.

## Publishing safeguards

Never force-add ignored datasets, generated bundles, backups, certificates, `.env` files, private keys or operational reports. The root ignore rules and explicit initial source allowlist are intentional. No application-code license is inferred from the separate attribution notice for data sources.
