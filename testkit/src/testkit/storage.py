"""A thin Supabase Storage client (form-check videos live in a private bucket)."""

from typing import Any, Self

import httpx


def effective_status(resp: httpx.Response) -> int:
    """The status a response really means.

    Storage answers most refusals with HTTP 400 and puts the real status in the
    body ({"statusCode": "403", ...}); every other service uses the HTTP status.
    """
    if resp.status_code == 400 and resp.headers.get("content-type", "").startswith(
        "application/json"
    ):
        body = resp.json()
        if isinstance(body, dict) and str(body.get("statusCode", "")).isdigit():
            return int(body["statusCode"])
    return resp.status_code


class StorageClient:
    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        api_key: str,
        access_token: str | None = None,
    ) -> None:
        self._http = http
        self._base_url = base_url
        self._url = f"{base_url}/storage/v1"
        self._api_key = api_key
        self._token = access_token

    def as_user(self, access_token: str) -> Self:
        return type(self)(self._http, self._base_url, self._api_key, access_token)

    def _headers(self) -> dict[str, str]:
        return {"apikey": self._api_key, "Authorization": f"Bearer {self._token or self._api_key}"}

    def upload(
        self, bucket: str, path: str, data: bytes, content_type: str = "video/mp4"
    ) -> httpx.Response:
        return self._http.post(
            f"{self._url}/object/{bucket}/{path}",
            content=data,
            headers={**self._headers(), "Content-Type": content_type},
        )

    def download(self, bucket: str, path: str) -> httpx.Response:
        return self._http.get(
            f"{self._url}/object/authenticated/{bucket}/{path}", headers=self._headers()
        )

    def public_download(self, bucket: str, path: str) -> httpx.Response:
        return self._http.get(f"{self._url}/object/public/{bucket}/{path}")

    def list_folder(self, bucket: str, prefix: str) -> httpx.Response:
        return self._http.post(
            f"{self._url}/object/list/{bucket}",
            json={"prefix": prefix, "limit": 100},
            headers=self._headers(),
        )

    def remove(self, bucket: str, paths: list[str]) -> httpx.Response:
        return self._http.request(
            "DELETE",
            f"{self._url}/object/{bucket}",
            json={"prefixes": paths},
            headers=self._headers(),
        )

    # -- buckets (an admin concern: users must not be able to change them) ------------

    def list_buckets(self) -> httpx.Response:
        return self._http.get(f"{self._url}/bucket", headers=self._headers())

    def create_bucket(self, body: dict[str, Any]) -> httpx.Response:
        return self._http.post(f"{self._url}/bucket", json=body, headers=self._headers())

    def update_bucket(self, bucket: str, body: dict[str, Any]) -> httpx.Response:
        return self._http.put(f"{self._url}/bucket/{bucket}", json=body, headers=self._headers())

    def delete_bucket(self, bucket: str) -> httpx.Response:
        return self._http.delete(f"{self._url}/bucket/{bucket}", headers=self._headers())
