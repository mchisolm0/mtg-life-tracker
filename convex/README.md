# Convex Backend

This directory contains the MVP remote match contract for Mana Ledger.

The project is not linked to a Convex deployment yet, so the backend functions use
Convex's generic server wrappers instead of `convex/_generated/server` imports.
After a Convex project is connected, run:

```sh
bun run convex:codegen
```

Then future slices can switch to the generated imports for stronger schema-aware
function typing.
