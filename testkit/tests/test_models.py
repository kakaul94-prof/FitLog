"""The contracts are strict: an unexpected field or type is a failure, not a coercion."""

import httpx
import pytest
from pydantic import ValidationError

from testkit.models import FunctionError, Measurement, parse_error, parse_rows

ROW = {
    "id": "8f14e45f-ceea-467a-9575-2e5f1b3f9a10",
    "user_id": "c9f0f895-fb98-4b91-8f9a-1e6d0d1d2c3b",
    "created_at": "2026-10-13T08:00:00+00:00",
    "measured_on": "2026-10-13",
    "type": "weight",
    "value": 180.4,
    "unit": "lb",
    "source": None,
}


def test_parse_rows_validates_a_postgrest_array() -> None:
    (row,) = parse_rows(Measurement, httpx.Response(200, json=[ROW]))
    assert row.value == 180.4


@pytest.mark.parametrize(
    "change",
    [{"surprise_column": 1}, {"value": "180.4"}, {"user_id": "not-a-uuid"}],
    ids=["extra column", "string for a number", "bad uuid"],
)
def test_a_row_that_drifts_from_the_contract_fails(change: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        parse_rows(Measurement, httpx.Response(200, json=[{**ROW, **change}]))


def test_a_function_error_is_one_message_and_nothing_else() -> None:
    assert FunctionError.model_validate({"error": "Try again."}).error == "Try again."
    with pytest.raises(ValidationError):
        FunctionError.model_validate({"error": "Bad gateway", "detail": "upstream body"})


def test_parse_error_reads_a_postgrest_error() -> None:
    body = {"code": "42501", "message": "new row violates row-level security policy"}
    error = parse_error(httpx.Response(403, json={**body, "details": None, "hint": None}))
    assert error.code == "42501"
