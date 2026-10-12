"""Data isolation as readable scenarios: features/data_isolation.feature.

The exhaustive per-table matrix lives in tests/authz; these are the same
guarantees told as stories a product owner can read and extend.
"""

from pytest_bdd import scenarios

scenarios("data_isolation.feature")
