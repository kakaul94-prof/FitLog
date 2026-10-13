"""`UserFactory`: unique users per run, all deleted at the end, newest first."""

import json

import httpx
import pytest

from testkit.auth import AdminAuth, AuthClient
from testkit.users import UserFactory

BASE = "http://127.0.0.1:54321"


class FakeGoTrue:
    """Just enough of Supabase Auth: create, sign in and delete users."""

    def __init__(self, failing_delete: str | None = None) -> None:
        self.deleted: list[str] = []
        self._ids: dict[str, str] = {}
        self._failing_delete = failing_delete

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path == "/auth/v1/admin/users":
            email = json.loads(request.content)["email"]
            self._ids[email] = f"id-{len(self._ids) + 1}"
            return httpx.Response(200, json={"id": self._ids[email]})
        if request.method == "POST" and path == "/auth/v1/token":
            email = json.loads(request.content)["email"]
            session = {"user": {"id": self._ids[email]}, "access_token": f"at-{email}"}
            return httpx.Response(200, json={**session, "refresh_token": "rt"})
        if request.method == "DELETE":
            user_id = path.rsplit("/", 1)[1]
            if user_id == self._failing_delete:
                return httpx.Response(500, text="database is busy")
            self.deleted.append(user_id)
            return httpx.Response(200)
        return httpx.Response(404)


def factory(gotrue: FakeGoTrue) -> UserFactory:
    http = httpx.Client(transport=httpx.MockTransport(gotrue))
    return UserFactory(AdminAuth(http, BASE, "service"), AuthClient(http, BASE, "anon"), "run7")


def test_each_user_is_new_signed_in_and_labelled_with_the_run() -> None:
    users = factory(FakeGoTrue())
    alice, bob = users.create("alice"), users.create("alice")
    assert (alice.email, bob.email) == ("alice-run7-1@api.test", "alice-run7-2@api.test")
    assert alice.id != bob.id
    assert alice.access_token == "at-alice-run7-1@api.test"


def test_delete_all_removes_tracked_users_too_newest_first() -> None:
    gotrue = FakeGoTrue()
    users = factory(gotrue)
    users.create("alice")
    users.track("signed-up-elsewhere")
    users.create("bob")
    users.delete_all()
    # A later user's rows may point at an earlier user's, so they go first.
    assert gotrue.deleted == ["id-2", "signed-up-elsewhere", "id-1"]


def test_a_failed_delete_warns_instead_of_hiding_the_test_result() -> None:
    gotrue = FakeGoTrue(failing_delete="id-1")
    users = factory(gotrue)
    users.create("alice")
    users.create("bob")
    with pytest.warns(UserWarning, match="could not delete test user id-1: 500"):
        users.delete_all()
    assert gotrue.deleted == ["id-2"]  # and it carried on with the rest
