"""The table registry is self-consistent, and the factory builds parents first.

The API suite's catalog tests check the registry against the real database;
these check it against itself and against its own contracts, offline.
"""

import json

import httpx
import pytest

from testkit.factories import build_row, create_row, new_token
from testkit.rest import RestClient
from testkit.tables import INSERTABLE, TABLES, TABLES_BY_NAME, RowContext, TableSpec


def test_each_table_is_registered_once() -> None:
    assert len(TABLES_BY_NAME) == len(TABLES)
    assert [t for t in INSERTABLE if t.one_per_user] == []


@pytest.mark.parametrize("spec", TABLES, ids=str)
def test_spec_matches_its_own_contract(spec: TableSpec) -> None:
    fields = spec.model.model_fields
    assert spec.owner_column in fields
    assert spec.edit[0] in fields, "the update probe edits a column the contract doesn't have"
    assert set(spec.parents.values()) <= set(TABLES_BY_NAME)


@pytest.mark.parametrize("spec", INSERTABLE, ids=str)
def test_sample_rows_only_use_contract_columns_and_their_parents(spec: TableSpec) -> None:
    parents = {alias: f"{alias}-id" for alias in spec.parents}
    row = spec.sample(RowContext(token="tok", parents=parents))
    assert set(row) <= set(spec.model.model_fields)
    assert [p for p in parents.values() if p not in row.values()] == []


def test_new_tokens_are_short_and_unique() -> None:
    tokens = {new_token() for _ in range(200)}
    assert len(tokens) == 200
    assert all(len(t) == 12 for t in tokens)


def recording_api(seen: list[httpx.Request]) -> RestClient:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        table = request.url.path.rsplit("/", 1)[1]
        if request.method == "GET":
            return httpx.Response(200, json=[{"id": "profile-id"}])
        return httpx.Response(201, json=[{"id": f"{table}-id", **json.loads(request.content)}])

    http = httpx.Client(transport=httpx.MockTransport(handle))
    return RestClient(http, "http://127.0.0.1:54321", "anon", "alice-token")


def test_build_row_creates_the_parent_first_as_the_same_user() -> None:
    seen: list[httpx.Request] = []
    row = build_row(recording_api(seen), TABLES_BY_NAME["workout_sets"])
    assert [(r.method, r.url.path) for r in seen] == [("POST", "/rest/v1/workouts")]
    assert seen[0].headers["authorization"] == "Bearer alice-token"
    assert row["workout_id"] == "workouts-id"


def test_a_two_parent_row_gets_both() -> None:
    seen: list[httpx.Request] = []
    row = build_row(recording_api(seen), TABLES_BY_NAME["recipe_ingredients"])
    assert len(seen) == 2  # the recipe and the ingredient are both foods
    assert row["recipe_food_id"] == row["ingredient_food_id"] == "foods-id"


def test_create_row_fetches_the_profile_instead_of_inserting_one() -> None:
    seen: list[httpx.Request] = []
    profile = create_row(recording_api(seen), TABLES_BY_NAME["profiles"])
    assert profile == {"id": "profile-id"}
    assert [r.method for r in seen] == ["GET"]
