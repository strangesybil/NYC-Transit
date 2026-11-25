from unittest.mock import patch
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from . import firebase_auth
from .stations import catalog, resolve_name
from .models import Favorite
from .test_favorites import CONFIG, auth, fake_verify
from .management.commands.import_stations import normalize

class CatalogTests(TestCase):
    def test_public_catalog_and_integrity(self):
        data = self.client.get("/api/stations/").json()
        stations = data["stations"]
        self.assertGreater(len(stations), 400)
        self.assertEqual(len(stations), len({s["id"] for s in stations}))
        self.assertTrue(all(s["lines"] and s["gtfs_stop_ids"] for s in stations))
        self.assertIsNone(resolve_name("23 St"))
        self.assertEqual(self.client.post("/api/stations/").status_code, 405)
    def test_multi_gtfs_station(self):
        station = next(s for s in catalog()["stations"] if s["id"] == "167")
        self.assertEqual(set(station["gtfs_stop_ids"]), {"A32", "D20"})
        self.assertEqual(set(station["lines"]), set("ACEBDFM"))
    def test_incomplete_import_rejected(self):
        with self.assertRaises(ValueError):
            normalize([])

@override_settings(FIREBASE_WEB_CONFIG=CONFIG)
@patch.object(firebase_auth, "verify_id_token", side_effect=fake_verify)
class StationFavoritesTests(TestCase):
    def post(self, body, uid="alice"):
        return self.client.post("/api/favorites/", body, content_type="application/json", **auth(uid))
    def test_same_name_stations_and_idempotence(self, _):
        stations = [s for s in catalog()["stations"] if s["name"] == "23 St"][:2]
        for station in stations:
            response = self.post({"kind": "station", "station_id": station["id"], "name": "ignored"})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["favorite"]["name"], "23 St")
            self.assertEqual(self.post({"kind": "station", "station_id": station["id"]}).status_code, 200)
        self.assertEqual(Favorite.objects.count(), 2)
    def test_invalid_id(self, _):
        for sid in ("missing", "", None):
            self.assertEqual(self.post({"kind": "station", "station_id": sid}).status_code, 400)
    def test_legacy_and_ownership(self, _):
        user = get_user_model().objects.create(username="alice")
        station = resolve_name("Astoria-Ditmars Blvd")
        legacy = Favorite.objects.create(user=user, kind="station", name=station["name"])
        response = self.post({"kind": "station", "station_id": station["id"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["favorite"]["id"], legacy.id)
        self.assertEqual(self.client.get("/api/favorites/", **auth("bob")).json()["favorites"], [])
        url = f"/api/favorites/{legacy.id}/"
        self.assertEqual(self.client.delete(url, **auth("bob")).status_code, 404)
        self.assertEqual(self.client.delete(url, **auth()).status_code, 204)
    def test_limit_and_existing_route(self, _):
        self.post({"kind":"route", "name":"A"})
        user = get_user_model().objects.get(username="alice")
        Favorite.objects.bulk_create([Favorite(user=user, kind="station", name=f"Legacy {i}") for i in range(49)])
        self.assertEqual(self.post({"kind":"station", "station_id":"1"}).status_code, 400)
        self.assertEqual(self.post({"kind":"route", "name":"A"}).status_code, 200)
    def test_database_station_uniqueness(self, _):
        user = get_user_model().objects.create(username="alice")
        Favorite.objects.create(user=user, kind="station", name="Old name", station_id="1")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Favorite.objects.create(user=user, kind="station", name="New name", station_id="1")

class LegacyMigrationTests(TestCase):
    def test_associates_only_unambiguous_names_and_preserves_routes(self):
        import importlib
        from django.apps import apps
        from django.db import connection
        from types import SimpleNamespace
        user = get_user_model().objects.create(username="legacy")
        clear = Favorite.objects.create(user=user, kind="station", name="Astoria-Ditmars Blvd")
        ambiguous = Favorite.objects.create(user=user, kind="station", name="23 St")
        route = Favorite.objects.create(user=user, kind="route", name="A")
        migration = importlib.import_module("myapp.migrations.0003_alter_favorite_unique_together_favorite_station_id_and_more")
        migration.associate_stations(apps, SimpleNamespace(connection=connection))
        clear.refresh_from_db(); ambiguous.refresh_from_db(); route.refresh_from_db()
        self.assertEqual(clear.station_id, "1")
        self.assertIsNone(ambiguous.station_id)
        self.assertEqual(route.name, "A")
        self.assertIsNone(route.station_id)

class StatusPagesTests(TestCase):
    def test_separate_destinations(self):
        for url, page in [("/", "lines"), ("/lines/", "lines"), ("/stations/", "stations")]:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.context["page"], page)
            self.assertContains(response, f'data-page="{page}"')
            self.assertContains(response, 'aria-label="Transit status pages"')
