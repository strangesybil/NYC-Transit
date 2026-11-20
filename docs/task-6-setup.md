# Firebase sign-in setup (Task 6)

Sign-in, saved lines and line alerts only switch on once the Firebase project id is set in
`nyctransit/settings.py`. Until then everything else works (status, alerts, elevator
outages), just without the Sign in button and Save line.

## 1. Create the Firebase project (one time, ~5 min)

1. Go to <https://console.firebase.google.com> → **Create a project** → name it
   `nyc-transit` → Google Analytics can be off.
2. **Build → Authentication → Get started → Sign-in method** → enable **Google**
   (pick a support email, save).
3. **Authentication → Settings → Authorized domains → Add domain**, and add the live
   site's domain, e.g. `nyctransit-env.eba-xxxxxxx.us-east-2.elasticbeanstalk.com`
   (no `http://`). `localhost` is already there for local testing.
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
| GET | `/api/favorites/` | | `{"favorites": [{"id", "kind", "name", "created_at"}]}` |
| POST | `/api/favorites/` | `{"kind": "route", "name": "A"}` | 201 created, 200 if already saved |
| DELETE | `/api/favorites/<id>/` | | 204 |

`kind` is `"route"` (must be a line we track) or `"station"` (any name, ready for
the map task). Max 50 per user. Without a valid token: 401. If Firebase isn't
configured on the server: 503.

## Elevator and escalator outages

`GET /api/elevators/` (or `?route=A`) lists elevators and escalators that are out of
service, from the MTA's `nyct_ene.json` feed (no key needed). The server downloads it at
most every 5 minutes and keeps it in memory (`myapp/elevators.py`). If the MTA is down,
it keeps showing the last list it got, with a warning. Each outage has `station`,
`lines`, `type`, `serving`, `accessible_route` (the step-free route for wheelchair
users), `since`, `back` and `upcoming`.
