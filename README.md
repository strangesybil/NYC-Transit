# NYC Transit Hub

A Django app for live NYC subway service information, with separate Line Status and Station Status pages. Riders can sign in with Google, save lines and stations, read current/upcoming alerts, and check published station accessibility alongside elevator/escalator outage reports.

## Run locally

Use Python 3.12 or newer. From this repository directory:

```sh
python3.12 -m venv venv
source venv/bin/activate
python -m pip install -r requirements-test.txt
python manage.py migrate
python manage.py runserver
```

Open [Line Status](http://localhost:8000/lines/) or [Station Status](http://localhost:8000/stations/). Use **localhost** for Google sign-in: Firebase authorizes it separately from `127.0.0.1`. The repository includes Firebase web configuration; see [Firebase setup](docs/task-6-setup.md) if sign-in reports an unauthorized hostname.

The app uses SQLite locally. The bundled catalog contains 493 stations and does not need to be downloaded at startup. Live service/equipment data is fetched from the MTA and retains available cached data when requests fail. Saved favorites require Google sign-in; public information does not.

## Verify

```sh
python manage.py test myapp
python manage.py check
python manage.py makemigrations --check --dry-run
```

For frontend tests, use Node.js 20 or newer:

```sh
npm ci
npm test
```

Node dependencies are test-only. There is no production frontend build step. The application serves native JavaScript modules and bundled SVG icons through Django static files.

## Features and limitations

- Search stations by name and filter by served line; similarly named stations have distinct IDs.
- Save lines/stations per account, with a combined limit of 50 favorites.
- Preview two current/upcoming alerts and expand the rest; expand descriptions for travel alternatives.
- Read plain-language step-free-access information and any supplied directional restrictions or equipment locations.
- Station alerts apply to its served lines, not necessarily the specific station. No matching outage report does not guarantee working equipment or step-free access.
- Saved-line change notifications operate while the page is open; no background push or email delivery is implemented.

## Documentation

- [Firebase setup and APIs](docs/task-6-setup.md)
- [Station catalog, favorites API and migration](docs/task-6-stations.md)
- [Frontend components, icons and responsive layout](docs/frontend-components.md)
- [CI checks, merge protection and AWS deployment](docs/ci-and-deployment.md)

## Deployment

Every branch push and PR into `main` runs GitHub Actions tests. Pushes to `main` deploy to AWS Elastic Beanstalk only after the Tests job passes. To block merges as well, a repository administrator must make **Tests** a required check for `main`; see the CI guide. Its container commands apply migrations and collect static files. Include migration `0003`, the bundled station JSON, and the licensed Lucide SVGs in the deployment. No npm installation or station catalog refresh is required on the server. AWS credentials belong in the deployment's GitHub secrets; Firebase authorized domains must include the deployed hostname.
