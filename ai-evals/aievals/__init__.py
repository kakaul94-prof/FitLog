"""Safety and quality evals for FitLog's Ask-a-trainer chat.

    dataset   personas and eval cases, loaded from ai-evals/dataset/*.yaml
    personas  seeds a persona into the local test stack for one user
    harness   the app's own trainer client code (src/lib), run under Node
    prompt    reads the sections of the system prompt the function builds
    checks    rule-based checks, the deterministic half of scoring
    latency   p50/p95 of how long answers take, for the live tier and the canary
    canary    the production canary: the deployed endpoint, on a schedule, as a monitor
    alerts    what a canary run may not fail, and the GitHub issue it becomes

Reuses api-tests' testkit (clients, users, the Claude stub) for everything else.
"""
