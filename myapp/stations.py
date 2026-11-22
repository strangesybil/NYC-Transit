"""Bundled MTA station catalog; never downloads data during requests."""
import json
from functools import lru_cache
from pathlib import Path
from django.http import JsonResponse
from django.views.decorators.http import require_GET

CATALOG_PATH = Path(__file__).with_name("data") / "stations.json"

@lru_cache(maxsize=1)
def catalog():
    return json.loads(CATALOG_PATH.read_text())

def station_by_id(station_id):
    return next((s for s in catalog()["stations"] if s["id"] == station_id), None)

def resolve_name(name):
    matches = [s for s in catalog()["stations"] if s["name"].casefold() == name.casefold()]
    return matches[0] if len(matches) == 1 else None

@require_GET
def stations_api(request):
    return JsonResponse(catalog())
