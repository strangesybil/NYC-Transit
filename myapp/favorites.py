"""Favorites API (Task 6): signed-in users save the lines they care about.

GET    /api/favorites/        -> {"favorites": [{"id", "kind", "name", "created_at"}, ...]}
POST   /api/favorites/        body {"kind": "route", "name": "A"}  -> 201 (or 200 if already saved)
DELETE /api/favorites/<id>/   -> 204

Every request needs  Authorization: Bearer <Firebase ID token>.
"""
import json
from functools import wraps

from django.contrib.auth import get_user_model
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import firebase_auth
from .stations import station_by_id, resolve_name
from .models import Favorite
from .mta import SUBWAY_ROUTES

BEARER_PREFIX = "Bearer "
MAX_FAVORITES_PER_USER = 50
MAX_NAME_LENGTH = 100  # matches Favorite.name max_length
MAX_USERNAME_LENGTH = 150  # Django's username limit (Firebase uids are at most 128)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def user_for_claims(claims):
    """Find (or create on first sign-in) the Django user for a Firebase account."""
    User = get_user_model()
    user, created = User.objects.get_or_create(username=claims["sub"][:MAX_USERNAME_LENGTH])
    email = claims.get("email", "")
    if created:
        user.set_unusable_password()  # they only ever sign in through Firebase
    if created or user.email != email:
        user.email = email
        user.save()
    return user


def firebase_login_required(view):
    """Reject the request unless it carries a valid Firebase ID token.

    CSRF is off for these views on purpose: we don't use cookies for auth here, so a
    malicious site can't make the browser send the token on its own.
    """

    @csrf_exempt
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not firebase_auth.is_configured():
            return _error("Sign-in isn't set up on this server yet.", 503)
        header = request.headers.get("Authorization", "")
        if not header.startswith(BEARER_PREFIX):
            return _error("Sign in to use favorites.", 401)
        try:
            claims = firebase_auth.verify_id_token(header[len(BEARER_PREFIX):].strip())
        except firebase_auth.InvalidToken:
            return _error("Your session expired. Please sign in again.", 401)
        request.firebase_user = user_for_claims(claims)
        return view(request, *args, **kwargs)

    return wrapper


def _serialize(favorite):
    return {
        "id": favorite.id,
        "kind": favorite.kind,
        "name": favorite.name,
        "created_at": favorite.created_at,
        "station_id": favorite.station_id,
    }


def _validate(body):
    """Return (kind, name) or raise ValueError with a message for the user."""
    kind = str(body.get("kind", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    if kind not in (Favorite.ROUTE, Favorite.STATION):
        raise ValueError('kind must be "route" or "station"')
    station_id = None
    if kind == Favorite.STATION:
        if "station_id" in body:
            station = station_by_id(str(body["station_id"]))
            if not station:
                raise ValueError("Unknown station ID")
        else:
            station = resolve_name(name)
        if station:
            station_id, name = station["id"], station["name"]
    if not name or len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"name must be 1-{MAX_NAME_LENGTH} characters")
    if kind == Favorite.ROUTE:
        name = name.upper()
        if name not in SUBWAY_ROUTES:
            raise ValueError(f'"{name}" is not a subway line we track')
    return kind, name, station_id


@firebase_login_required
@require_http_methods(["GET", "POST"])
def favorites_api(request):
    user = request.firebase_user
    if request.method == "GET":
        favorites = user.favorites.order_by("created_at", "id")
        return JsonResponse({"favorites": [_serialize(f) for f in favorites]})

    try:
        body = json.loads(request.body or b"{}")
        if not isinstance(body, dict):
            raise ValueError("send a JSON object")
        kind, name, station_id = _validate(body)
    except json.JSONDecodeError:
        return _error("Request body must be JSON.", 400)
    except ValueError as exc:
        return _error(str(exc), 400)

    if station_id:
        existing = user.favorites.filter(kind=kind, station_id=station_id).first()
        # Upgrade a legacy favorite only when the name identifies one station.
        if not existing and resolve_name(name):
            existing = user.favorites.filter(kind=kind, name=name, station_id__isnull=True).first()
            if existing:
                existing.station_id = station_id
                existing.save(update_fields=["station_id"])
    else:
        existing = user.favorites.filter(kind=kind, name=name, station_id__isnull=True).first()
    if existing:  # saving twice is fine: just return what's there
        return JsonResponse({"favorite": _serialize(existing), "created": False})
    if user.favorites.count() >= MAX_FAVORITES_PER_USER:
        return _error(f"You can save up to {MAX_FAVORITES_PER_USER} favorites.", 400)
    lookup = {"user": user, "kind": kind, "station_id": station_id}
    if not station_id:
        lookup["name"] = name
    favorite, created = Favorite.objects.get_or_create(**lookup, defaults={"name": name})
    return JsonResponse({"favorite": _serialize(favorite), "created": created}, status=201 if created else 200)


@firebase_login_required
@require_http_methods(["DELETE"])
def favorite_detail_api(request, favorite_id):
    # Filtering by user means nobody can delete someone else's favorite (they get a 404).
    deleted, _ = request.firebase_user.favorites.filter(id=favorite_id).delete()
    if not deleted:
        return _error("Favorite not found.", 404)
    return HttpResponse(status=204)
