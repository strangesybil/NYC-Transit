import time
from unittest.mock import patch

from django.test import TestCase

from . import views
from .mta import parse_alerts, route_statuses, save_alerts


def make_payload(start_offset, end_offset, alert_id="lmm:alert:1", route="A", kind="Delays"):
    now = int(time.time())
    return {
        "entity": [
            {
                "id": alert_id,
                "alert": {
                    "active_period": [{"start": now + start_offset, "end": now + end_offset}],
                    "informed_entity": [{"route_id": route}, {"route_id": "C"}],
                    "transit_realtime.mercury_alert": {"alert_type": kind},
                    "header_text": {"translation": [{"text": "A trains are delayed", "language": "en"}]},
                    "description_text": {"translation": [{"text": "Signal problem", "language": "en"}]},
                },
            },
            {"id": "no-alert-here"},  # must be skipped, not crash
        ]
    }


ACTIVE = make_payload(-3600, 3600)
FUTURE = make_payload(86400, 90000)
EXPIRED = make_payload(-90000, -86400)


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
        self.assertEqual(a["status"], "Good Service")
        self.assertEqual(a["alerts"], 0)
        self.assertEqual(a["upcoming"], 1)

    def test_expired_alert_ignored(self):
        save_alerts(parse_alerts(EXPIRED))
        a = route_statuses()["A"]
        self.assertEqual((a["status"], a["alerts"], a["upcoming"]), ("Good Service", 0, 0))

    def test_unplanned_outranks_planned(self):
        planned = make_payload(-3600, 3600, "p1", "A", "Planned - Stops Skipped")
        delays = make_payload(-3600, 3600, "d1", "A", "Delays")
        planned["entity"] += delays["entity"][:1]
        save_alerts(parse_alerts(planned))
        self.assertEqual(route_statuses()["A"]["status"], "Delays")


class ApiTests(TestCase):
    def setUp(self):
        views._last_sync = 0.0

    @patch("myapp.views.sync_alerts")
    def test_alerts_endpoint_filters(self, _sync):
        save_alerts(parse_alerts(ACTIVE))
        save_alerts(parse_alerts(ACTIVE) + parse_alerts(make_payload(86400, 90000, "future", "L")))
        self.assertEqual(self.client.get("/api/alerts/").json()["count"], 2)
        self.assertEqual(self.client.get("/api/alerts/?route=a").json()["count"], 1)
        self.assertEqual(self.client.get("/api/alerts/?route=L").json()["count"], 1)
        self.assertEqual(self.client.get("/api/alerts/?route=L&active=1").json()["count"], 0)

    @patch("myapp.views.sync_alerts", side_effect=OSError("offline"))
    def test_network_failure_does_not_crash(self, _sync):
        response = self.client.get("/api/status/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Could not reach the MTA", response.json()["warning"])
