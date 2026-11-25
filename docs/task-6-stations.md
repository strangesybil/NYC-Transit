# Station search and saved stations

Run `python manage.py migrate` before starting the updated app. Use http://localhost:8000 for Google sign-in; Firebase authorizes hostnames separately, so 127.0.0.1 may not work.

## Pages

- `/lines/`: line status, alerts and saved lines; `/` remains a compatible entry point.
- `/stations/`: station search, line filtering, saved stations and accessibility details.
- Station line badges link to `/lines/?route=<route>` to open the corresponding line.

## Catalog

Source: MTA Subway Stations, https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f
The bundled JSON records its retrieval date and source URL. Station IDs identify individual stations, not transfer complexes. Multiple GTFS records for one station are merged. Shuttle routes map to the existing dashboard IDs GS, FS and H; SIR maps to SI.

Refresh from the project directory:

```sh
python manage.py import_stations
# Or download the source JSON separately and use:
python manage.py import_stations --source-file /path/to/export.json
```

Review the generated catalog diff before committing. `outage_names` contains exact official station names; add only reviewed explicit aliases when the equipment feed uses another name. The import command preserves existing reviewed aliases by stable station ID.

GET /api/stations/ is public and returns source, retrieved_at and stations. Each station includes id, name, borough, lines, gtfs_stop_ids, accessibility, accessibility_notes and outage_names.

POST /api/favorites/ accepts `{ "kind": "station", "station_id": "1" }` with an existing Firebase bearer token. The server derives the name. Responses add nullable station_id; route requests remain unchanged. Legacy name-only station requests remain supported for compatibility. Unambiguous existing names are associated by the migration; ambiguous records remain removable from Your stations.

Station alerts apply to served lines, not necessarily the selected station. Outages require an exact reviewed name and a shared line. No matching equipment report does not guarantee accessibility. Catalog accessibility is published information, separate from live outages.

## Verification

```sh
python manage.py test myapp
npm ci
npm test
```

Manual acceptance: sign in at localhost; save a line and station; refresh; sign out and back in; verify persistence. Confirm another account cannot see these favorites. Check keyboard search/result selection, mobile layout, an empty search and retry after catalog failure. Google sign-in requires a real browser/account and is not bypassed by tests.

## Migration and deployment

Migration `0003` adds nullable station IDs, uniqueness constraints, and a frozen mapping that associates only unambiguous legacy station names. Existing route favorites and unresolved legacy station favorites remain intact. Same-name stations can be saved independently by ID. Run migrations before serving updated favorites requests. Elastic Beanstalk already runs `migrate --noinput` and `collectstatic --noinput` in its deployment configuration.

The catalog and Lucide SVGs are bundled and must be committed with the application. No catalog import, npm build, or icon download is required during deployment. Live MTA feeds and real Google sign-in still require network access. Alerts are line-wide, and equipment reports are outage-only, so missing reports do not establish that all equipment is working.
