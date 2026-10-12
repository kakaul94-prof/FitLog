"""A thin PostgREST client.

Every method returns the raw `httpx.Response`, because the status code and error
body are usually what a test is checking. `row()` and `rows()` are the
convenience path for setup code that expects success.
"""

from collections.abc import Mapping
from typing import Any, Self

import httpx

Row = dict[str, Any]


class ApiError(AssertionError):
    """A setup call failed. Carries the response body so the cause is in the report."""


class RestClient:
    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        api_key: str,
        access_token: str | None = None,
    ) -> None:
        self._http = http
        self._base_url = base_url
        self._url = f"{base_url}/rest/v1"
        self._api_key = api_key
        self.access_token = access_token

    def as_user(self, access_token: str) -> Self:
        """The same client, signed in as someone."""
        return type(self)(self._http, self._base_url, self._api_key, access_token)

    def _headers(self, prefer: str | None = None, schema: str | None = None) -> dict[str, str]:
        # supabase-js sends the anon key as the bearer token when signed out,
        # so an anonymous request here looks exactly like the app's.
        headers = {
            "apikey": self._api_key,
            "Authorization": f"Bearer {self.access_token or self._api_key}",
        }
        if prefer:
            headers["Prefer"] = prefer
        if schema:  # PostgREST picks the schema from these; "public" when absent
            headers["Accept-Profile"] = headers["Content-Profile"] = schema
        return headers

    @staticmethod
    def _eq(match: Mapping[str, object] | None) -> dict[str, str]:
        return {column: f"eq.{value}" for column, value in (match or {}).items()}

    def select(
        self,
        table: str,
        match: Mapping[str, object] | None = None,
        columns: str = "*",
        *,
        schema: str | None = None,
    ) -> httpx.Response:
        params = {"select": columns, **self._eq(match)}
        return self._http.get(
            f"{self._url}/{table}", params=params, headers=self._headers(schema=schema)
        )

    def insert(
        self,
        table: str,
        body: Row | list[Row],
        *,
        upsert_on: str | None = None,
        schema: str | None = None,
    ) -> httpx.Response:
        prefer = "return=representation"
        params: dict[str, str] = {}
        if upsert_on:
            prefer += ",resolution=merge-duplicates"
            params["on_conflict"] = upsert_on
        return self._http.post(
            f"{self._url}/{table}",
            params=params,
            json=body,
            headers=self._headers(prefer, schema),
        )

    def update(self, table: str, values: Row, match: Mapping[str, object]) -> httpx.Response:
        return self._http.patch(
            f"{self._url}/{table}",
            params=self._eq(match),
            json=values,
            headers=self._headers("return=representation"),
        )

    def delete(self, table: str, match: Mapping[str, object]) -> httpx.Response:
        return self._http.delete(
            f"{self._url}/{table}",
            params=self._eq(match),
            headers=self._headers("return=representation"),
        )

    def rpc(self, function: str, args: Row | None = None) -> httpx.Response:
        return self._http.post(
            f"{self._url}/rpc/{function}", json=args or {}, headers=self._headers()
        )

    def openapi(self) -> httpx.Response:
        return self._http.get(f"{self._url}/", headers=self._headers())

    # -- convenience for setup code ------------------------------------------

    def rows(self, table: str, match: Mapping[str, object] | None = None) -> list[Row]:
        resp = self.select(table, match)
        _expect(resp, 200)
        result: list[Row] = resp.json()
        return result

    def row(self, table: str, row_id: str) -> Row | None:
        found = self.rows(table, {"id": row_id})
        return found[0] if found else None

    def create(self, table: str, body: Row) -> Row:
        resp = self.insert(table, body)
        _expect(resp, 201)
        created: Row = resp.json()[0]
        return created


def _expect(resp: httpx.Response, status: int) -> None:
    if resp.status_code != status:
        raise ApiError(
            f"{resp.request.method} {resp.request.url.path} -> {resp.status_code}, "
            f"expected {status}: {resp.text}"
        )
