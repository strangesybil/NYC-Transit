"""Checks Firebase ID tokens sent by the browser (Task 6).

How sign-in works:
1. The browser signs the user in with Firebase (Google or email/password).
2. Firebase gives the browser a short-lived ID token (a signed JWT).
3. The browser sends it to our API as:  Authorization: Bearer <token>
4. We check the token's signature against Google's public certificates and make
   sure it was issued for OUR Firebase project. If it checks out, we trust the uid.

No secrets are needed for this: only the Firebase project id.
"""
import json
import re
import threading
import time
import urllib.request

from django.conf import settings
from google.auth import exceptions as google_exceptions
from google.auth import jwt

# Google's public certificates for Firebase ID tokens (they rotate every few hours).
FIREBASE_CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
)
FIREBASE_ISSUER_PREFIX = "https://securetoken.google.com/"
DEFAULT_CERT_CACHE_SECONDS = 3600  # used if Google doesn't send a max-age
CERT_FETCH_TIMEOUT_SECONDS = 10
CLOCK_SKEW_SECONDS = 10  # tolerate small clock differences between servers
MAX_AGE_PATTERN = re.compile(r"max-age=(\d+)")

_certs = None  # {key_id: pem_certificate}
_certs_expire_at = 0.0
_certs_lock = threading.Lock()


class InvalidToken(Exception):
    """The token is missing, expired, forged, or for a different Firebase project."""


def project_id():
    return getattr(settings, "FIREBASE_WEB_CONFIG", {}).get("projectId", "")


def is_configured():
    return bool(project_id())


def _download_certs():
    request = urllib.request.Request(FIREBASE_CERTS_URL, headers={"User-Agent": "nyc-transit"})
    with urllib.request.urlopen(request, timeout=CERT_FETCH_TIMEOUT_SECONDS) as response:
        certs = json.load(response)
        match = MAX_AGE_PATTERN.search(response.headers.get("Cache-Control", ""))
    max_age = int(match.group(1)) if match else DEFAULT_CERT_CACHE_SECONDS
    return certs, max_age


def get_certs():
    """Google's certificates, cached for as long as Google says they stay valid."""
    global _certs, _certs_expire_at
    with _certs_lock:
        if _certs is None or time.time() >= _certs_expire_at:
            _certs, max_age = _download_certs()
            _certs_expire_at = time.time() + max_age
        return _certs


def verify_id_token(token):
    """Return the token's claims (uid in "sub", plus "email", "name"...) or raise InvalidToken."""
    pid = project_id()
    if not pid:
        raise InvalidToken("Firebase is not configured on the server")
    if not token:
        raise InvalidToken("no token")
    try:
        claims = jwt.decode(
            token,
            certs=get_certs(),
            audience=pid,
            clock_skew_in_seconds=CLOCK_SKEW_SECONDS,
        )
    except (ValueError, google_exceptions.GoogleAuthError) as exc:
        raise InvalidToken(str(exc)) from exc
    except OSError as exc:  # could not download Google's certificates
        raise InvalidToken(f"could not check token right now ({exc})") from exc

    if claims.get("iss") != FIREBASE_ISSUER_PREFIX + pid:
        raise InvalidToken("token was issued for a different project")
    if not claims.get("sub"):
        raise InvalidToken("token has no user id")
    return claims
