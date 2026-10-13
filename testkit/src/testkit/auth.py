"""Supabase Auth (GoTrue) clients.

`AuthClient` calls the auth API the way the app does, with the public anon key.
`AdminAuth` uses the service-role key and exists only so fixtures can create and
delete test users; no test ever sends a request under test with it.
"""

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class SignedInUser:
    """A real user with a real session from the password sign-in endpoint."""

    id: str
    email: str
    password: str
    access_token: str
    refresh_token: str


class AuthClient:
    def __init__(self, http: httpx.Client, base_url: str, anon_key: str) -> None:
        self._http = http
        self._url = f"{base_url}/auth/v1"
        self._anon_key = anon_key

    def _headers(self, access_token: str | None = None) -> dict[str, str]:
        headers = {"apikey": self._anon_key}
        if access_token is not None:
            headers["Authorization"] = f"Bearer {access_token}"
        return headers

    def sign_up(self, email: str, password: str) -> httpx.Response:
        return self._http.post(
            f"{self._url}/signup",
            headers=self._headers(),
            json={"email": email, "password": password},
        )

    def sign_in(self, email: str, password: str) -> httpx.Response:
        return self._http.post(
            f"{self._url}/token",
            params={"grant_type": "password"},
            headers=self._headers(),
            json={"email": email, "password": password},
        )

    def refresh(self, refresh_token: str) -> httpx.Response:
        return self._http.post(
            f"{self._url}/token",
            params={"grant_type": "refresh_token"},
            headers=self._headers(),
            json={"refresh_token": refresh_token},
        )

    def sign_out(self, access_token: str) -> httpx.Response:
        return self._http.post(f"{self._url}/logout", headers=self._headers(access_token))

    def get_user(self, access_token: str | None) -> httpx.Response:
        return self._http.get(f"{self._url}/user", headers=self._headers(access_token))

    def update_user(self, access_token: str, changes: dict[str, Any]) -> httpx.Response:
        """What a signed-in user may change about their own account (PUT /user)."""
        return self._http.put(
            f"{self._url}/user", headers=self._headers(access_token), json=changes
        )

    def admin_request(
        self, method: str, path: str, access_token: str | None, body: dict[str, Any] | None = None
    ) -> httpx.Response:
        """Call an /admin endpoint with an ordinary token, for privilege-escalation tests."""
        return self._http.request(
            method, f"{self._url}/admin/{path}", headers=self._headers(access_token), json=body
        )

    def signed_in(self, email: str, password: str) -> SignedInUser:
        resp = self.sign_in(email, password)
        resp.raise_for_status()
        body = resp.json()
        return SignedInUser(
            id=body["user"]["id"],
            email=email,
            password=password,
            access_token=body["access_token"],
            refresh_token=body["refresh_token"],
        )


class AdminAuth:
    """Service-role user management, for fixtures only."""

    def __init__(self, http: httpx.Client, base_url: str, service_role_key: str) -> None:
        self._http = http
        self._url = f"{base_url}/auth/v1/admin/users"
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

    def create_user(self, email: str, password: str) -> str:
        """Create a confirmed user and return its id."""
        resp = self._http.post(
            self._url,
            headers=self._headers,
            json={"email": email, "password": password, "email_confirm": True},
        )
        resp.raise_for_status()
        user_id: str = resp.json()["id"]
        return user_id

    def delete_user(self, user_id: str) -> httpx.Response:
        return self._http.delete(f"{self._url}/{user_id}", headers=self._headers)

    def find_user_id(self, email: str) -> str | None:
        """Look a user up by email (used to clean up after sign-up tests)."""
        resp = self._http.get(self._url, headers=self._headers, params={"per_page": 1000})
        resp.raise_for_status()
        for user in resp.json()["users"]:
            if user["email"] == email:
                found: str = user["id"]
                return found
        return None
