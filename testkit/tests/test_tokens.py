"""The hand-made JWTs: each must be exactly as broken as its name says."""

import jwt
import pytest

from testkit.tokens import (
    FORGED_TOKENS,
    claims_of,
    make_token,
    unsigned,
    with_claims,
    without_signature,
)

SECRET = "local-test-jwt-secret-with-at-least-32-bytes"
ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


def verify(token: str) -> dict[str, object]:
    """What the database API does with a bearer token."""
    claims: dict[str, object] = jwt.decode(
        token, SECRET, algorithms=["HS256"], audience="authenticated"
    )
    return claims


def test_make_token_is_shaped_like_a_supabase_session() -> None:
    claims = verify(make_token(SECRET, sub=ALICE, expires_in=300))
    assert claims["sub"] == ALICE
    assert claims["role"] == "authenticated"
    assert claims["exp"] == claims["iat"] + 300  # type: ignore[operator]


def test_with_claims_edits_the_payload_but_keeps_the_original_signature() -> None:
    real = make_token(SECRET, sub=ALICE, expires_in=300)
    edited = with_claims(real, sub=BOB)
    assert claims_of(edited)["sub"] == BOB
    assert edited.split(".")[2] == real.split(".")[2]
    with pytest.raises(jwt.InvalidSignatureError):
        verify(edited)


def test_unsigned_tokens_carry_no_signature() -> None:
    real = make_token(SECRET, sub=ALICE, expires_in=300)
    assert jwt.get_unverified_header(unsigned(real))["alg"] == "none"
    assert unsigned(real).endswith(".")
    assert without_signature(real) == real.rsplit(".", 1)[0] + "."


@pytest.mark.parametrize("kind", sorted(FORGED_TOKENS))
def test_no_forged_token_passes_verification(kind: str) -> None:
    real = make_token(SECRET, sub=ALICE, expires_in=300)
    forged = FORGED_TOKENS[kind](real, BOB, SECRET)
    assert forged != real
    with pytest.raises(jwt.PyJWTError):
        verify(forged)
