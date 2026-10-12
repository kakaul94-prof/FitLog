"""Reusable building blocks for testing FitLog's backend.

Nothing in here asserts anything: these are the clients, data builders and
helpers that test suites are written with. Any suite can import them (the
package installs with `pip install -e api-tests`).

    config          where the suite points; refuses anything but a local stack
    auth            Supabase Auth (GoTrue) client + service-role user admin
    rest            PostgREST client (the app's database API)
    storage         Supabase Storage client (form-check videos)
    functions       client for the Cloudflare Pages Functions under /api
    tokens          hand-made JWTs: expired, forged, tampered, unsigned
    users           per-run test users, deleted (with all their rows) at the end
    tables          the registry of per-user tables every isolation test runs over
    factories       builds valid rows for any table, parents first
    models          pydantic response contracts
    db              psycopg helpers that act as a user, to test RLS policies directly
    leaks           scans a response for secrets, internals and other users' data
    anthropic_stub  a recording stand-in for the Claude API
"""
