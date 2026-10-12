"""Authentication flows: sign-up, sign-in, refresh and sign-out."""

import secrets
import time

import httpx

from testkit.auth import AuthClient, SignedInUser
from testkit.models import Profile, parse_rows
from testkit.rest import RestClient
from testkit.tokens import claims_of
from testkit.users import UserFactory


def _auth_error_code(resp: httpx.Response) -> str:
    body = resp.json()
    return str(body.get("error_code") or body.get("code"))


# -- sign-up -------------------------------------------------------------------


def test_sign_up_returns_a_session_and_creates_the_profile(
    auth: AuthClient, users: UserFactory, anon_api: RestClient
) -> None:
    email = users.email("signup")

    resp = auth.sign_up(email, secrets.token_urlsafe(12))

    assert resp.status_code == 200
    body = resp.json()
    users.track(body["user"]["id"])
    assert body["user"]["email"] == email
    assert body["access_token"], "email confirmation is off locally, so sign-up signs you in"

    profiles = parse_rows(Profile, anon_api.as_user(body["access_token"]).select("profiles"))
    assert [str(p.id) for p in profiles] == [body["user"]["id"]]
    assert profiles[0].activity_level == "moderate"  # schema defaults applied
    assert profiles[0].calorie_goal_mode == "calculated"


def test_sign_up_with_a_registered_email_is_refused(auth: AuthClient, owner: SignedInUser) -> None:
    resp = auth.sign_up(owner.email, secrets.token_urlsafe(12))

    assert resp.status_code == 422
    assert _auth_error_code(resp) == "user_already_exists"


def test_sign_up_with_a_short_password_is_refused(auth: AuthClient, users: UserFactory) -> None:
    resp = auth.sign_up(users.email("weak"), "12345")  # minimum is 6

    assert resp.status_code == 422
    assert _auth_error_code(resp) == "weak_password"


# -- sign-in -------------------------------------------------------------------


def test_sign_in_issues_a_token_for_that_user(auth: AuthClient, owner: SignedInUser) -> None:
    resp = auth.sign_in(owner.email, owner.password)

    assert resp.status_code == 200
    claims = claims_of(resp.json()["access_token"])
    assert claims["sub"] == owner.id
    assert claims["role"] == "authenticated"
    assert claims["aud"] == "authenticated"
    assert claims["exp"] > time.time()


def test_sign_in_with_the_wrong_password_is_refused(auth: AuthClient, owner: SignedInUser) -> None:
    resp = auth.sign_in(owner.email, owner.password + "x")

    assert resp.status_code == 400
    assert _auth_error_code(resp) == "invalid_credentials"


def test_unknown_and_wrong_password_sign_ins_look_identical(
    auth: AuthClient, owner: SignedInUser, users: UserFactory
) -> None:
    """The response must not reveal whether an email has an account."""
    wrong_password = auth.sign_in(owner.email, "not-the-password")
    unknown_email = auth.sign_in(users.email("nobody"), "not-the-password")

    assert unknown_email.status_code == wrong_password.status_code
    assert unknown_email.json() == wrong_password.json()


# -- refresh and sign-out ----------------------------------------------------------


def test_refresh_issues_a_new_token_for_the_same_user(
    auth: AuthClient, fresh_user: SignedInUser
) -> None:
    resp = auth.refresh(fresh_user.refresh_token)

    assert resp.status_code == 200
    assert claims_of(resp.json()["access_token"])["sub"] == fresh_user.id


def test_replaying_an_old_refresh_token_is_refused(
    auth: AuthClient, fresh_user: SignedInUser
) -> None:
    """Reuse detection: a used refresh token turning up again means it was copied.

    Supabase forgives two benign replays: one inside a 10 s window (a flaky
    network retrying) and the token just before the current one (a client that
    crashed before saving the new token). Anything older is refused.
    """
    second = auth.refresh(fresh_user.refresh_token).json()["refresh_token"]
    current = auth.refresh(second).json()["refresh_token"]
    time.sleep(11)  # past refresh_token_reuse_interval in supabase/config.toml

    replay = auth.refresh(fresh_user.refresh_token)

    assert replay.status_code == 400
    assert _auth_error_code(replay) == "refresh_token_already_used"
    assert auth.refresh(current).status_code == 200, "the real user's session carries on"


def test_sign_out_revokes_the_refresh_token(auth: AuthClient, fresh_user: SignedInUser) -> None:
    assert auth.sign_out(fresh_user.access_token).status_code == 204

    resp = auth.refresh(fresh_user.refresh_token)

    assert resp.status_code == 400
    assert _auth_error_code(resp) == "refresh_token_not_found"


def test_sign_out_ends_the_session_for_the_auth_api(
    auth: AuthClient, fresh_user: SignedInUser
) -> None:
    """The auth API checks the session behind a token, not just its signature.

    This is why the Pages Functions verify callers through /auth/v1/user rather
    than checking the JWT locally: a signed-out token stops working there at once.
    """
    auth.sign_out(fresh_user.access_token)

    resp = auth.get_user(fresh_user.access_token)

    assert resp.status_code == 403
    assert _auth_error_code(resp) == "session_not_found"
