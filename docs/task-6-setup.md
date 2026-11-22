# Firebase sign-in setup (Task 6)

The repository already contains Firebase web configuration. Sign-in and saving lines/stations work at `http://localhost:8000` when that hostname is authorized in the Firebase project. The setup steps below are for a new Firebase project or deployment. If `projectId` is empty, public status pages still work but account features are hidden.

See [local setup](../README.md), [station data and favorites](task-6-stations.md), and [frontend components](frontend-components.md).

## 1. Create the Firebase project (one time, ~5 min)

1. Go to <https://console.firebase.google.com> → **Create a project** → name it
   `nyc-transit` → Google Analytics can be off.
2. **Build → Authentication → Get started → Sign-in method** → enable **Google**
   (pick a support email, save).
3. **Authentication → Settings → Authorized domains → Add domain**, and add the live
   site's domain, e.g. `nyctransit-env.eba-xxxxxxx.us-east-2.elasticbeanstalk.com`
   (no `http://`). Add `localhost` for local testing if it is absent, and use http://localhost:8000. The hostname 127.0.0.1 is separate.
4. **Project settings** (gear icon) → **General** → **Your apps** → click the web
   icon `</>` → nickname `nyc-transit-web` → **Register app** (skip Hosting).
   Firebase shows a `firebaseConfig` object.

## 2. Put the config in the app

Copy four values from that `firebaseConfig` into `FIREBASE_WEB_CONFIG` at the
bottom of `nyctransit/settings.py` as the second argument of each `get`:

```python
FIREBASE_WEB_CONFIG = {
    'apiKey': os.environ.get('FIREBASE_API_KEY', 'AIza...'),
    'authDomain': os.environ.get('FIREBASE_AUTH_DOMAIN', 'nyc-transit-xxxx.firebaseapp.com'),
    'projectId': os.environ.get('FIREBASE_PROJECT_ID', 'nyc-transit-xxxx'),
    'appId': os.environ.get('FIREBASE_APP_ID', '1:1234:web:abcd'),
}
```

These are **not secrets**. Firebase sends them to every visitor's browser, so
committing them is fine. (Anyone who'd rather not can set the same names as
Elastic Beanstalk environment variables instead.)

Commit, push, merge to `main`, and the deploy picks it up.

## How it works

1. The browser signs in with Google through Firebase (`static/myapp/auth.js`).
2. Firebase gives it a short-lived ID token, and every favorites request sends it
   as `Authorization: Bearer <token>` (`static/myapp/favorites.js`).
3. The server checks the token's signature against Google's public certificates
   and that it was issued for our project (`myapp/firebase_auth.py`). No service
   account or secret key is needed.
4. First sign-in creates a Django user whose username is the Firebase uid, and
   favorites are stored in the existing `Favorite` model (`myapp/favorites.py`).

## API

| Method | URL | Body | Result |
|---|---|---|---|
| GET | `/api/favorites/` | | Favorites containing `id`, `kind`, `name`, `station_id` and `created_at` |
| POST | `/api/favorites/` | `{"kind": "route", "name": "A"}` | 201 created, 200 if already saved |
| POST | `/api/favorites/` | `{"kind": "station", "station_id": "1"}` | 201 created, 200 if already saved |
| DELETE | `/api/favorites/<id>/` | | 204 |

`kind` is `"route"` (must be a line we track) or `"station"` (prefer a catalog station ID; the server derives its name). Legacy name-only station requests remain supported. `station_id` is null for route and unresolved legacy favorites. Max 50 favorites per user. Without a valid token: 401. If Firebase isn't
configured on the server: 503.

## Elevator and escalator outages

`GET /api/elevators/` (or `?route=A`) lists elevators and escalators that are out of
service, from the MTA's `nyct_ene.json` feed (no key needed). The server downloads it at
most every 5 minutes and keeps it in memory (`myapp/elevators.py`). If the MTA is down,
it keeps showing the last list it got, with a warning. Each outage has `station`,
`lines`, `equipment`, `type`, `serving`, `reason`, `accessible_route` (the step-free route for wheelchair
users), `since`, `back` and `upcoming`.
