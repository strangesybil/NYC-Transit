"""Tests for Firebase sign-in and the favorites API (Task 6)."""
import time
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from google.auth import crypt, jwt

from . import firebase_auth
from .models import Favorite

PROJECT_ID = "nyc-transit-test"
CONFIG = {"apiKey": "k", "authDomain": "x.firebaseapp.com", "projectId": PROJECT_ID, "appId": "a"}
NO_CONFIG = {"apiKey": "", "authDomain": "", "projectId": "", "appId": ""}
KEY_ID = "test-key"
URL = "/api/favorites/"


def fake_verify(token):
    """Stand-in for real verification: token "good-<uid>" is valid for that uid."""
    if not token.startswith("good-"):
        raise firebase_auth.InvalidToken("bad token")
    uid = token[len("good-"):]
    return {"sub": uid, "email": f"{uid}@example.com"}


def auth(uid="alice"):
    return {"HTTP_AUTHORIZATION": f"Bearer good-{uid}"}


@override_settings(FIREBASE_WEB_CONFIG=CONFIG)
@patch.object(firebase_auth, "verify_id_token", side_effect=fake_verify)
class FavoritesApiTests(TestCase):
    def post(self, body, uid="alice"):
        return self.client.post(URL, body, content_type="application/json", **auth(uid))

    def test_requires_sign_in(self, _):
        self.assertEqual(self.client.get(URL).status_code, 401)
        self.assertEqual(self.client.get(URL, HTTP_AUTHORIZATION="Bearer nope").status_code, 401)

    def test_starts_empty_and_creates_user_on_first_sign_in(self, _):
        response = self.client.get(URL, **auth())
        self.assertEqual(response.json(), {"favorites": []})
        user = get_user_model().objects.get(username="alice")
        self.assertEqual(user.email, "alice@example.com")
        self.assertFalse(user.has_usable_password())

    def test_add_list_and_delete(self, _):
        created = self.post({"kind": "route", "name": "a"})  # lowercase is normalized
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["favorite"]["name"], "A")

        names = [f["name"] for f in self.client.get(URL, **auth()).json()["favorites"]]
        self.assertEqual(names, ["A"])

        fav_id = created.json()["favorite"]["id"]
        self.assertEqual(self.client.delete(f"{URL}{fav_id}/", **auth()).status_code, 204)
        self.assertEqual(self.client.get(URL, **auth()).json()["favorites"], [])

    def test_saving_twice_is_harmless(self, _):
        first = self.post({"kind": "route", "name": "L"})
        second = self.post({"kind": "route", "name": "L"})
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.json()["created"])
        self.assertEqual(first.json()["favorite"]["id"], second.json()["favorite"]["id"])
        self.assertEqual(Favorite.objects.count(), 1)

    def test_stations_can_be_saved_too(self, _):
        response = self.post({"kind": "station", "name": "Times Sq-42 St"})
        self.assertEqual(response.status_code, 201)

    def test_rejects_bad_input(self, _):
        for body in (
            {"kind": "route", "name": "X"},  # not a real line
            {"kind": "bus", "name": "M15"},  # unknown kind
            {"kind": "station", "name": ""},
            {"kind": "station", "name": "x" * 101},
            ["not", "an", "object"],
        ):
            self.assertEqual(self.post(body).status_code, 400, body)
        bad_json = self.client.post(URL, "{oops", content_type="application/json", **auth())
        self.assertEqual(bad_json.status_code, 400)

    def test_limit_per_user(self, _):
        user = get_user_model().objects.create(username="alice")
        for i in range(50):
            Favorite.objects.create(user=user, kind="station", name=f"Station {i}")
        self.assertEqual(self.post({"kind": "route", "name": "A"}).status_code, 400)

    def test_users_only_see_and_delete_their_own(self, _):
        fav_id = self.post({"kind": "route", "name": "G"}, uid="alice").json()["favorite"]["id"]
        self.assertEqual(self.client.get(URL, **auth("bob")).json()["favorites"], [])
        self.assertEqual(self.client.delete(f"{URL}{fav_id}/", **auth("bob")).status_code, 404)
        self.assertTrue(Favorite.objects.filter(id=fav_id).exists())

    def test_wrong_method(self, _):
        self.assertEqual(self.client.put(URL, **auth()).status_code, 405)
        self.assertEqual(self.client.get(f"{URL}1/", **auth()).status_code, 405)


@override_settings(FIREBASE_WEB_CONFIG=NO_CONFIG)
class NotConfiguredTests(TestCase):
    def test_api_says_sign_in_is_off(self):
        self.assertEqual(self.client.get(URL, **auth()).status_code, 503)

    def test_dashboard_hides_sign_in(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "firebase-config")


@override_settings(FIREBASE_WEB_CONFIG=CONFIG)
class DashboardConfigTests(TestCase):
    def test_dashboard_gets_firebase_config(self):
        response = self.client.get("/")
        self.assertContains(response, 'id="firebase-config"')
        self.assertContains(response, PROJECT_ID)


@override_settings(FIREBASE_WEB_CONFIG=CONFIG)
class TokenVerificationTests(TestCase):
    """Signs real JWTs with a throwaway key, so the actual checks are exercised."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        public_pem = key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        cls.signer = crypt.RSASigner.from_string(private_pem, key_id=KEY_ID)
        cls.certs = {KEY_ID: public_pem.decode()}

    def setUp(self):
        patcher = patch.object(firebase_auth, "get_certs", return_value=self.certs)
        patcher.start()
        self.addCleanup(patcher.stop)

    def make_token(self, **overrides):
        now = int(time.time())
        claims = {
            "iss": f"https://securetoken.google.com/{PROJECT_ID}",
            "aud": PROJECT_ID,
            "sub": "user-123",
            "email": "rider@example.com",
            "iat": now,
            "exp": now + 3600,
        }
        claims.update(overrides)
        return jwt.encode(self.signer, claims).decode()

    def test_valid_token(self):
        claims = firebase_auth.verify_id_token(self.make_token())
        self.assertEqual(claims["sub"], "user-123")

    def test_rejects_bad_tokens(self):
        now = int(time.time())
        bad = {
            "other project": self.make_token(aud="someone-else"),
            "wrong issuer": self.make_token(iss="https://securetoken.google.com/someone-else"),
            "expired": self.make_token(iat=now - 7200, exp=now - 3600),
            "no user": self.make_token(sub=""),
            "tampered": self.make_token()[:-4] + "AAAA",
            "garbage": "not-a-jwt",
            "empty": "",
        }
        for label, token in bad.items():
            with self.subTest(label), self.assertRaises(firebase_auth.InvalidToken):
                firebase_auth.verify_id_token(token)

    def test_end_to_end_through_the_api(self):
        headers = {"HTTP_AUTHORIZATION": f"Bearer {self.make_token()}"}
        response = self.client.post(
            URL, {"kind": "route", "name": "7"}, content_type="application/json", **headers
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Favorite.objects.filter(user__username="user-123", name="7").exists())
