"""Form-check videos: the private `form-videos` bucket is isolated per user.

Objects live under "<user id>/...", and the storage policies only let a user
touch their own folder. Each test uploads a small fake clip as the owner, then
checks what another user and a signed-out visitor can do with it.
"""

from collections.abc import Iterator
from uuid import uuid4

import httpx
import pytest

from testkit.auth import SignedInUser
from testkit.storage import StorageClient

BUCKET = "form-videos"
CLIP = b"\x00\x00\x00\x18ftypmp42" + b"fitlog-api-test" * 8  # bytes shaped like an MP4


@pytest.fixture
def owner_storage(anon_storage: StorageClient, owner: SignedInUser) -> StorageClient:
    return anon_storage.as_user(owner.access_token)


@pytest.fixture
def intruder_storage(anon_storage: StorageClient, intruder: SignedInUser) -> StorageClient:
    return anon_storage.as_user(intruder.access_token)


@pytest.fixture
def owner_clip(owner_storage: StorageClient, owner: SignedInUser) -> Iterator[str]:
    """Path of a clip the owner uploaded; removed afterwards."""
    path = f"{owner.id}/{uuid4().hex}.mp4"
    resp = owner_storage.upload(BUCKET, path, CLIP)
    assert resp.status_code == 200, resp.text
    yield path
    owner_storage.remove(BUCKET, [path])


def _storage_error(resp: httpx.Response) -> tuple[int, str]:
    """Storage answers refusals with HTTP 400 and puts the real status + code in the body."""
    assert resp.status_code == 400, resp.text
    body = resp.json()
    return int(body["statusCode"]), body["code"]


def test_owner_can_upload_and_download_their_own_clip(
    owner_storage: StorageClient, owner_clip: str
) -> None:
    resp = owner_storage.download(BUCKET, owner_clip)

    assert resp.status_code == 200
    assert resp.content == CLIP


def test_another_user_cannot_download_your_clip(
    intruder_storage: StorageClient, owner_clip: str
) -> None:
    resp = intruder_storage.download(BUCKET, owner_clip)

    # "Not found", exactly like a missing file: nothing confirms the clip exists.
    assert _storage_error(resp) == (404, "NoSuchKey")


def test_another_user_sees_an_empty_listing_of_your_folder(
    intruder_storage: StorageClient, owner_clip: str, owner: SignedInUser
) -> None:
    resp = intruder_storage.list_folder(BUCKET, owner.id)

    assert resp.status_code == 200
    assert resp.json() == []


def test_another_user_cannot_delete_your_clip(
    intruder_storage: StorageClient, owner_storage: StorageClient, owner_clip: str
) -> None:
    resp = intruder_storage.remove(BUCKET, [owner_clip])

    assert resp.status_code == 200
    assert resp.json() == [], "nothing should have been deleted"
    assert owner_storage.download(BUCKET, owner_clip).content == CLIP


def test_you_cannot_upload_into_another_users_folder(
    intruder_storage: StorageClient, owner: SignedInUser
) -> None:
    resp = intruder_storage.upload(BUCKET, f"{owner.id}/{uuid4().hex}.mp4", CLIP)

    assert _storage_error(resp) == (403, "AccessDenied")


def test_signed_out_visitors_cannot_download_clips(
    anon_storage: StorageClient, owner_clip: str
) -> None:
    resp = anon_storage.download(BUCKET, owner_clip)

    assert _storage_error(resp) == (404, "NoSuchKey")


def test_clips_have_no_public_url(anon_storage: StorageClient, owner_clip: str) -> None:
    resp = anon_storage.public_download(BUCKET, owner_clip)

    # The public route can't even see a private bucket.
    assert _storage_error(resp) == (404, "NoSuchBucket")


def test_signed_out_visitors_cannot_upload(anon_storage: StorageClient) -> None:
    resp = anon_storage.upload(BUCKET, f"{uuid4()}/{uuid4().hex}.mp4", CLIP)

    assert _storage_error(resp) == (403, "AccessDenied")
