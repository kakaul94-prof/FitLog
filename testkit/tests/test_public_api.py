"""The package's contract with the suites that install it."""

import re
import subprocess
import sys
from importlib.metadata import version
from importlib.resources import files

import testkit


def test_every_public_name_is_importable_from_the_package() -> None:
    assert [name for name in testkit.__all__ if not hasattr(testkit, name)] == []
    assert len(testkit.__all__) == len(set(testkit.__all__))


def test_the_version_is_semver_and_matches_the_installed_metadata() -> None:
    assert re.fullmatch(r"\d+\.\d+\.\d+", testkit.__version__)
    assert version("fitlog-testkit") == testkit.__version__


def test_the_package_ships_its_type_information() -> None:
    # Without py.typed, mypy treats every testkit import in a suite as Any.
    assert files("testkit").joinpath("py.typed").is_file()


def test_importing_the_package_leaves_the_stub_server_module_alone() -> None:
    # `python -m testkit.anthropic_stub` warns if the package already imported it.
    code = "import sys, testkit; print('testkit.anthropic_stub' in sys.modules)"
    out = subprocess.run(  # noqa: S603 (our own interpreter, fixed arguments)
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert out.stdout.strip() == "False"
