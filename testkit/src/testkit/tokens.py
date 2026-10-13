"""Hand-made JWTs for the negative auth tests (expired, forged, tampered, unsigned).

`make_token` builds a token shaped exactly like the ones Supabase Auth issues.
The other helpers start from a real or well-formed token and break exactly one
thing about it, so a test that sees it rejected knows why.
"""

import base64
import json
import secrets
import time
from collections.abc import Callable
from typing import Any

import jwt


def make_token(
    secret: str,
    *,
    sub: str,
    expires_in: int,
    role: str = "authenticated",
    aud: str = "authenticated",
) -> str:
    """A token shaped like the ones Supabase Auth issues, signed with `secret`."""
    now = int(time.time())
    claims = {"sub": sub, "role": role, "aud": aud, "iat": now, "exp": now + expires_in}
    return jwt.encode(claims, secret, algorithm="HS256")


def with_claims(token: str, **changes: str | int) -> str:
    """The same token with its payload edited but its original signature kept."""
    header, payload, signature = token.split(".")
    claims = json.loads(_b64decode(payload))
    claims.update(changes)
    return f"{header}.{_b64encode(claims)}.{signature}"


def unsigned(token: str) -> str:
    """The same claims re-issued with `alg: none` and no signature at all."""
    return f"{_b64encode({'alg': 'none', 'typ': 'JWT'})}.{token.split('.')[1]}."


def without_signature(token: str) -> str:
    """The same header and claims with the signature cut off."""
    header, payload, _ = token.split(".")
    return f"{header}.{payload}."


def claims_of(token: str) -> dict[str, Any]:
    """Read a token's claims without verifying it (for asserting what was issued)."""
    decoded: dict[str, Any] = jwt.decode(token, options={"verify_signature": False})
    return decoded


TokenForger = Callable[[str, str, str], str]
"""Builds a bad token from (a real access token, the victim's user id, the JWT secret)."""

FORGED_TOKENS: dict[str, TokenForger] = {
    # Correctly signed, but no longer valid.
    "expired": lambda _real, victim, secret: make_token(secret, sub=victim, expires_in=-60),
    # Valid claims, signed by someone who doesn't hold the project's secret.
    "wrong-signing-key": lambda _real, victim, _secret: make_token(
        secrets.token_hex(32), sub=victim, expires_in=300
    ),
    # A real token with its claims edited and the original signature kept.
    "altered-user": lambda real, victim, _secret: with_claims(real, sub=victim),
    "altered-role": lambda real, _victim, _secret: with_claims(real, role="service_role"),
    "altered-audience": lambda real, _victim, _secret: with_claims(real, aud="admin"),
    "altered-expiry": lambda real, _victim, _secret: with_claims(
        real, exp=int(time.time()) + 365 * 86400
    ),
    # Signature stripped or switched off.
    "signature-removed": lambda real, _victim, _secret: without_signature(real),
    "alg-none": lambda real, victim, _secret: unsigned(with_claims(real, sub=victim)),
    # Not a JWT at all.
    "garbage": lambda _real, _victim, _secret: "not-a-jwt",
}
"""Every kind of bad token the auth tests try, on every API surface."""


def _b64encode(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def _b64decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
