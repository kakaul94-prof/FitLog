"""Creates signed-in users for a test run and deletes them all at the end."""

import secrets
import warnings
from itertools import count

from testkit.auth import AdminAuth, AuthClient, SignedInUser


class UserFactory:
    """Creates signed-in users for this run and deletes them all at the end."""

    def __init__(self, admin: AdminAuth, auth: AuthClient, run_id: str) -> None:
        self._admin = admin
        self._auth = auth
        self._run_id = run_id
        self._serial = count(1)
        self._created: list[str] = []

    def email(self, label: str) -> str:
        return f"{label}-{self._run_id}-{next(self._serial)}@api.test"

    def create(self, label: str) -> SignedInUser:
        email, password = self.email(label), secrets.token_urlsafe(12)
        self._created.append(self._admin.create_user(email, password))
        return self._auth.signed_in(email, password)

    def track(self, user_id: str) -> None:
        """Delete a user created some other way (e.g. by a sign-up test) at the end."""
        self._created.append(user_id)

    def delete_all(self) -> None:
        # Newest first: a later user's rows may reference an earlier user's
        # (see the cross-user foreign key tests), and must go first.
        for user_id in reversed(self._created):
            resp = self._admin.delete_user(user_id)
            if resp.status_code not in (200, 204, 404):
                warnings.warn(
                    f"could not delete test user {user_id}: {resp.status_code} {resp.text}",
                    stacklevel=1,
                )
