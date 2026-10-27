# `accessor` fields

**Why node cannot be the oracle:** node v24's V8 does not parse the
`accessor` keyword (`SyntaxError: Unexpected identifier`), and
`--experimental-transform-types` leaves it in place.

**The oracle these need:** TypeScript's emit with `target: "ES2022"` (or lower),
which turns each `accessor` into a private field and a getter and setter
pair. With `target: "ESNext"` TypeScript emits `accessor` as written.
