"""Tests for elevator/escalator outages."""
from unittest.mock import patch

from django.test import TestCase

from . import elevators

SAMPLE = [
    {"station": "Jamaica-179 St", "trainno": "F", "equipment": "EL433", "equipmenttype": "EL",
     "serving": "mezzanine to terminal platform", "ADA": "Y",
     "outagedate": "09/28/2026 10:00:00 PM", "estimatedreturntoservice": "09/29/2026 06:00:00 AM",
     "reason": "Maintenance", "isupcomingoutage": "Y"},
    {"station": "Times Sq-42 St", "trainno": "A/C/E/N/Q/R/W/1/2/3/7/S", "equipment": "ES200",
     "equipmenttype": "ES", "serving": "street to mezzanine", "ADA": "N",
     "outagedate": "11/01/2026 08:15:00 AM", "estimatedreturntoservice": "",
     "reason": "Repair", "isupcomingoutage": "N"},
    {"station": "Court Sq", "trainno": "7/G/LIRR", "equipment": "EL300", "equipmenttype": "EL",
     "serving": "street to platform", "ADA": "Y",
     "outagedate": "11/02/2026 01:00:00 PM", "estimatedreturntoservice": "11/10/2026 05:00:00 PM",
     "reason": "Repair", "isupcomingoutage": "N"},
    {"station": "", "equipment": "EL999"},  # broken row: skipped
    "not a dict",  # broken row: skipped
]


class ParsingTests(TestCase):
    def test_parses_and_sorts_accessible_elevators_first(self):
        outages = elevators.parse_outages(SAMPLE)
        self.assertEqual([o["equipment"] for o in outages], ["EL300", "EL433", "ES200"])
        court = outages[0]
        self.assertEqual(court["lines"], ["7", "G"])  # LIRR dropped
        self.assertEqual(court["type"], "Elevator")
        self.assertTrue(court["accessible_route"])
        self.assertFalse(court["upcoming"])
        self.assertEqual(court["back"].isoformat(), "2026-11-10T17:00:00-05:00")  # New York time

    def test_shuttle_means_all_three(self):
        self.assertEqual(elevators.parse_lines("7/S"), ["7", "GS", "FS", "H"])

    def test_bad_dates_become_none(self):
        self.assertIsNone(elevators.parse_mta_date(""))
        self.assertIsNone(elevators.parse_mta_date("2026-11-01"))
        self.assertIsNone(elevators.parse_mta_date(None))

    def test_garbage_payload(self):
        self.assertEqual(elevators.parse_outages({"oops": True}), [])
        self.assertEqual(elevators.parse_outages(None), [])


class ApiTests(TestCase):
    def setUp(self):
        elevators.reset_cache()
        self.addCleanup(elevators.reset_cache)

    @patch.object(elevators, "fetch_payload", return_value=SAMPLE)
    def test_filter_by_line(self, _):
        data = self.client.get("/api/elevators/?route=g").json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["outages"][0]["station"], "Court Sq")
        self.assertIsNone(data["warning"])
        self.assertEqual(self.client.get("/api/elevators/").json()["count"], 3)

    @patch.object(elevators, "fetch_payload", return_value=SAMPLE)
    def test_cached_between_requests(self, fetch):
        self.client.get("/api/elevators/")
        self.client.get("/api/elevators/")
        self.assertEqual(fetch.call_count, 1)

    def test_keeps_old_list_when_mta_fails(self):
        with patch.object(elevators, "fetch_payload", return_value=SAMPLE):
            self.client.get("/api/elevators/")
        elevators._cache["fetched_at"] = None  # pretend the cache expired
        with patch.object(elevators, "fetch_payload", side_effect=OSError("timed out")):
            data = self.client.get("/api/elevators/").json()
        self.assertEqual(data["count"], 3)
        self.assertIn("showing the last saved list", data["warning"])

    @patch.object(elevators, "fetch_payload", side_effect=OSError("no network"))
    def test_no_data_yet(self, _):
        data = self.client.get("/api/elevators/").json()
        self.assertEqual(data["count"], 0)
        self.assertIn("no data yet", data["warning"])
