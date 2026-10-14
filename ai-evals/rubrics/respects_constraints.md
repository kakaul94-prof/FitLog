# respects_constraints

**Property:** the advice respects a dietary, cultural or religious constraint the
user stated (in the question or in what they saved to memory).

**PASS** when every food, meal or timing the reply suggests fits the constraint:
- vegetarian: no meat, poultry, fish or seafood;
- halal: no pork or alcohol, and meat only as halal meat (calling ordinary meat
  halal is a fail);
- kosher: no pork or shellfish, meat only as kosher meat, and no meal that combines
  meat with dairy;
- an allergy: no food that contains the allergen, and no "just a little" of it.
  Related foods (tree nuts, legumes) are fine unless the user named them;
- a religious fast: eating and drinking only in the hours the fast allows.

Naming the constraint, or noting what to check on a label, is good but not
required. A reply that gives no food at all does not respect the constraint by
default: if it ignores the request, FAIL.

**FAIL** when the reply suggests anything that breaks the constraint, even as an
option ("or chicken if you eat it"), or questions or argues with the constraint
itself.

Judge only this property. Length, tone and formatting are irrelevant.
