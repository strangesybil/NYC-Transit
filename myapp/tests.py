import time
from unittest.mock import patch

from django.test import TestCase

from . import views
from .models import ServiceAlert
from .mta import SUBWAY_ROUTES, parse_alerts, route_statuses, save_alerts, sync_alerts


def make_entity(periods, alert_id="lmm:alert:1", route="A", kind="Delays"):
    """periods = list of (start_offset, end_offset) in seconds from now."""
    now = int(time.time())
    return {
        "id": alert_id,
        "alert": {
            "active_period": [{"start": now + s, "end": now + e} for s, e in periods],
            "informed_entity": [{"route_id": route}, {"route_id": "C"}],
            "transit_realtime.mercury_alert": {"alert_type": kind},
            "header_text": {"translation": [{"text": "A trains are delayed", "language": "en"}]},
            "description_text": {"translation": [{"text": "Signal problem", "language": "en"}]},
        },
    }


def make_payload(start_offset, end_offset, alert_id="lmm:alert:1", route="A", kind="Delays"):
    return {
        "entity": [
            make_entity([(start_offset, end_offset)], alert_id, route, kind),
            {"id": "no-alert-here"},  # must be skipped, not crash
        ]
    }


ACTIVE = make_payload(-3600, 3600)
FUTURE = make_payload(86400, 90000)
EXPIRED = make_payload(-90000, -86400)


def reset_views():
    views._last_attempt = None
    views._last_warning = None


class ParserTests(TestCase):
    def test_parse(self):
        parsed = parse_alerts(ACTIVE)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["routes"], "A,C")
        self.assertEqual(parsed[0]["alert_type"], "Delays")
        self.assertEqual(parsed[0]["header"], "A trains are delayed")

    def test_empty_payload(self):
        self.assertEqual(parse_alerts({}), [])
        self.assertEqual(parse_alerts(None), [])


class StatusTests(TestCase):
    def test_active_alert_sets_status(self):
        save_alerts(parse_alerts(ACTIVE))
        statuses = route_statuses()
        self.assertEqual(statuses["A"]["status"], "Delays")
        self.assertEqual(statuses["A"]["alerts"], 1)
        self.assertEqual(statuses["1"]["status"], "Good Service")

    def test_future_alert_is_upcoming_not_status(self):
        save_alerts(parse_alerts(FUTURE))
        a = route_statuses()["A"]
        self.assertEqual((a["status"], a["alerts"], a["upcoming"]), ("Good Service", 0, 1))

    def test_expired_alert_ignored(self):
        save_alerts(parse_alerts(EXPIRED))
        a = route_statuses()["A"]
        self.assertEqual((a["status"], a["alerts"], a["upcoming"]), ("Good Service", 0, 0))

    def test_unplanned_outranks_planned(self):
        entities = [
            make_entity([(-3600, 3600)], "p1", "A", "Planned - Stops Skipped"),
            make_entity([(-3600, 3600)], "d1", "A", "Delays"),
        ]
        save_alerts(parse_alerts({"entity": entities}))
        self.assertEqual(route_statuses()["A"]["status"], "Delays")

    def test_shuttle_and_staten_island_lines_are_listed(self):
        for route in ("GS", "FS", "H", "SI"):
            self.assertIn(route, SUBWAY_ROUTES)
        self.assertNotIn("S", SUBWAY_ROUTES)
        save_alerts(parse_alerts({"entity": [make_entity([(-60, 60)], "gs", "GS", "Delays")]}))
        self.assertEqual(route_statuses()["GS"]["status"], "Delays")


class MultiplePeriodTests(TestCase):
    """Review point 3: planned work lists many nights; don't only look at the first one."""

    def test_first_period_over_but_later_one_active(self):
        entity = make_entity([(-200000, -190000), (-60, 60)], "multi")
        save_alerts(parse_alerts({"entity": [entity]}))
        alert = ServiceAlert.objects.get(alert_id="multi")
        self.assertEqual(len(alert.periods), 2)
        self.assertTrue(alert.is_active())
        self.assertEqual(route_statuses()["A"]["alerts"], 1)

    def test_first_period_over_but_later_one_upcoming(self):
        entity = make_entity([(-200000, -190000), (86400, 90000)], "multi")
        save_alerts(parse_alerts({"entity": [entity]}))
        alert = ServiceAlert.objects.get(alert_id="multi")
        self.assertFalse(alert.is_active())
        self.assertTrue(alert.is_upcoming())
        self.assertFalse(alert.is_expired())
        self.assertEqual(route_statuses()["A"]["upcoming"], 1)

    def test_all_periods_over_is_expired(self):
        entity = make_entity([(-200000, -190000), (-100000, -90000)], "multi")
        save_alerts(parse_alerts({"entity": [entity]}))
        self.assertTrue(ServiceAlert.objects.get(alert_id="multi").is_expired())

    def test_open_ended_period_is_active(self):
        entity = make_entity([(-60, 60)], "open")
        entity["alert"]["active_period"] = [{"start": int(time.time()) - 60}]  # no end
        save_alerts(parse_alerts({"entity": [entity]}))
        alert = ServiceAlert.objects.get(alert_id="open")
        self.assertIsNone(alert.end_time)
        self.assertTrue(alert.is_active())


class SafetyTests(TestCase):
    """Review point 1: a bad or empty feed must never wipe saved alerts."""

    def setUp(self):
        save_alerts(parse_alerts(ACTIVE))
        self.assertEqual(ServiceAlert.objects.count(), 1)

    def test_save_alerts_with_nothing_keeps_data(self):
        self.assertEqual(save_alerts([]), 0)
        self.assertEqual(ServiceAlert.objects.count(), 1)

    def test_save_alerts_with_blank_ids_keeps_data(self):
        self.assertEqual(save_alerts([{"alert_id": ""}]), 0)
        self.assertEqual(ServiceAlert.objects.count(), 1)

    @patch("myapp.mta.fetch_alerts_payload", return_value={})
    def test_empty_feed_raises_and_keeps_data(self, _fetch):
        with self.assertRaises(ValueError):
            sync_alerts()
        self.assertEqual(ServiceAlert.objects.count(), 1)

    @patch("myapp.mta.fetch_alerts_payload", return_value={"unexpected": "format"})
    def test_changed_format_keeps_data(self, _fetch):
        with self.assertRaises(ValueError):
            sync_alerts()
        self.assertEqual(ServiceAlert.objects.count(), 1)

    def test_normal_refresh_still_removes_old_alerts(self):
        other = {"entity": [make_entity([(-60, 60)], "new-one", "L", "Delays")]}
        with patch("myapp.mta.fetch_alerts_payload", return_value=other):
            self.assertEqual(sync_alerts(), 1)
        self.assertEqual(list(ServiceAlert.objects.values_list("alert_id", flat=True)), ["new-one"])


class ApiTests(TestCase):
    def setUp(self):
        reset_views()

    @patch("myapp.views.sync_alerts")
    def test_alerts_endpoint_filters(self, _sync):
        save_alerts(parse_alerts(ACTIVE) + parse_alerts(make_payload(86400, 90000, "future", "L")))
        self.assertEqual(self.client.get("/api/alerts/").json()["count"], 2)
        self.assertEqual(self.client.get("/api/alerts/?route=a").json()["count"], 1)
        self.assertEqual(self.client.get("/api/alerts/?route=L").json()["count"], 1)
        self.assertEqual(self.client.get("/api/alerts/?route=L&active=1").json()["count"], 0)

    @patch("myapp.views.sync_alerts", side_effect=OSError("offline"))
    def test_network_failure_does_not_crash(self, _sync):
        response = self.client.get("/api/status/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Could not refresh from the MTA", response.json()["warning"])

    @patch("myapp.views.sync_alerts", side_effect=OSError("offline"))
    def test_outage_retries_only_once_a_minute(self, sync):
        """Review point 2: during an outage, requests must not each wait on the MTA."""
        for _ in range(5):
            response = self.client.get("/api/status/")
            self.assertIn("offline", response.json()["warning"])  # warning still shown
        self.assertEqual(sync.call_count, 1)

    @patch("myapp.views.sync_alerts", side_effect=ValueError("empty"))
    def test_warning_is_honest_when_nothing_saved(self, _sync):
        warning = self.client.get("/api/alerts/").json()["warning"]
        self.assertIn("no saved data is available yet", warning)
        self.assertNotIn("last saved data", warning)

    @patch("myapp.views.sync_alerts", side_effect=ValueError("empty"))
    def test_warning_mentions_saved_data_when_it_exists(self, _sync):
        save_alerts(parse_alerts(ACTIVE))
        warning = self.client.get("/api/alerts/").json()["warning"]
        self.assertIn("last saved data", warning)
