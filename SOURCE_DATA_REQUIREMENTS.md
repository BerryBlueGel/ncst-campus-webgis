# Source-only distribution

This repository intentionally does not distribute the campus datasets or production installation.

## Separately supplied inputs

- `web/public/data/`: generated GIS layers, feature catalog and metadata.
- `web/public/models/`: runtime campus GLB assets.
- `geojson/`, `reference/`, `output/`, `blender/`: authoritative geometries, imagery and modeling work files.
- Intermediate files referenced by historical generators, such as `reference/**/input.json`, measured stadium inventories and build/readback reports. They are not application source and are not distributed.

Restore these files only from authorized, separately maintained inputs. Do not substitute fabricated campus geometry just to make a data-dependent test pass. Frontend compile-time TypeScript modules and reviewed `web/src/gis/three/*Manifest.json` configuration are now included, so the frontend can build without the actual campus assets. Loading the real map/model and running data-dependent tests still require those separate assets. The source is not a complete redistributable campus asset bundle.

## Included source/configuration

The owner authorized publication of inline building dimensions, hand-traced display coordinates, roof groups, names and model binding parameters. These are included with the implementation and are explicitly approximate, not survey data. All modeling/generation/export/validation scripts, frontend tools, historical diagnostic page source and non-secret deployment templates are included. Scripts do not run automatically when cloned; some historical jobs require earlier intermediate versions. Review each script's inputs and output paths before execution. Deployment/cleanup scripts can mutate or remove scoped files and must not be run blindly.

Python scripts resolve the repository root relative to their own file. `CAMPUS_GEOREF_TIF` can override the legacy georeferenced image location for the GeoTIFF inspection/preview tools. `CAMPUS_BROWSER_ACCEPTANCE` overrides the historical browser-acceptance JSON path. Raw source images and that acceptance evidence remain external.

`docs/previews/` contains exactly three user-supplied UI screenshots permitted for the README. These are the only newly published preview images; source aerial/map imagery is still excluded.

The Java backend source, Flyway schema migrations, Maven wrapper and local PostGIS Compose template contain no database rows. It requires an externally supplied data root for import and a `DB_PASSWORD` supplied by the operator; no credential is included.

## Local checks

```sh
cd web
npm ci
npx tsx --test tests/brand-icons.test.ts tests/site-discovery.test.ts tests/camera-sync.test.ts
```

Run `npm run build` to compile the frontend. Check available test filenames before running individual tests; run the full `npm test` only after restoring licensed local inputs. Full-project results reported for the production workspace are not a claim that the repository alone reproduces the online campus.

## Publishing safeguards

Never force-add ignored datasets, generated bundles, backups, certificates, `.env` files, private keys or operational reports. Run `node tools/audit-source-publication.mjs` for staged changes and `node tools/audit-source-publication.mjs --all` for the full Git index before publishing. No application-code license is inferred from the separate attribution notice for data sources.
