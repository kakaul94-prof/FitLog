"""Two devices editing the same row: how the server resolves it.

FitLog has no conflict detection. Each edit sends only the fields it changed
(a PATCH), so edits to different fields from two devices are both kept, and
for the same field the last save wins with no error or warning. An edit to a
row another device has deleted matches nothing and also reports success.
These tests pin that down so a change to it is a deliberate decision.
"""

import pytest

from testkit.auth import AuthClient, SignedInUser
from testkit.factories import create_row
from testkit.rest import RestClient, Row
from testkit.tables import TABLES_BY_NAME

DIARY = TABLES_BY_NAME["diary_entries"]


@pytest.fixture
def phone(fresh_api: RestClient) -> RestClient:
    return fresh_api


@pytest.fixture
def tablet(anon_api: RestClient, auth: AuthClient, fresh_user: SignedInUser) -> RestClient:
    """The same account signed in a second time: another device, its own session."""
    second = auth.signed_in(fresh_user.email, fresh_user.password)
    return anon_api.as_user(second.access_token)


@pytest.fixture
def entry(phone: RestClient) -> Row:
    return create_row(phone, DIARY)


def stored(api: RestClient, row: Row) -> Row:
    found = api.row(DIARY.name, row["id"])
    assert found is not None
    return found


def test_edits_to_different_fields_are_both_kept(
    phone: RestClient, tablet: RestClient, entry: Row
) -> None:
    assert phone.update(DIARY.name, {"servings": 2}, {"id": entry["id"]}).status_code == 200
    assert tablet.update(DIARY.name, {"meal": "lunch"}, {"id": entry["id"]}).status_code == 200

    final = stored(phone, entry)
    assert (final["servings"], final["meal"]) == (2, "lunch")


def test_edits_to_the_same_field_last_save_wins(
    phone: RestClient, tablet: RestClient, entry: Row
) -> None:
    phone.update(DIARY.name, {"servings": 2}, {"id": entry["id"]})
    second = tablet.update(DIARY.name, {"servings": 3}, {"id": entry["id"]})

    assert second.status_code == 200, "no conflict is reported"
    assert stored(phone, entry)["servings"] == 3


def test_an_edit_to_a_row_deleted_elsewhere_changes_nothing(
    phone: RestClient, tablet: RestClient, entry: Row
) -> None:
    assert phone.delete(DIARY.name, {"id": entry["id"]}).status_code == 200

    late = tablet.update(DIARY.name, {"servings": 4}, {"id": entry["id"]})

    assert late.status_code == 200
    assert late.json() == [], "the edit matched no row, and nothing came back to life"
    assert tablet.rows(DIARY.name, {"id": entry["id"]}) == []
