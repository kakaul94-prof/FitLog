"""What a live run cost, from the token counts the API reported (never estimated).

Prices are Anthropic's list prices in USD per million tokens. Thinking tokens
are billed as output, so a judge's thinking is in `output_tokens` already.
"""

from dataclasses import dataclass

# model id -> (input, output) USD per million tokens
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.00, 5.00),  # the trainer (functions/api/trainer.ts)
    "claude-sonnet-5-5": (2.00, 10.00),  # the judge
}


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens, self.output_tokens + other.output_tokens
        )


def price(model: str) -> tuple[float, float]:
    """The prices for `model`, which may be a dated snapshot of a listed id."""
    for known, prices in PRICES.items():
        if model == known or model.startswith(f"{known}-"):
            return prices
    raise KeyError(f"no price for model {model!r}: add it to aievals/pricing.py")


def cost_usd(model: str, usage: Usage) -> float:
    per_in, per_out = price(model)
    return (usage.input_tokens * per_in + usage.output_tokens * per_out) / 1_000_000
