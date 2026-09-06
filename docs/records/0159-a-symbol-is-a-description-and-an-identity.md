# 0159 — A symbol is a description and an identity, and the floor is the corpus

The JVM lane refused a symbol as a runtime value for as long as it has existed.
The refusal read like a verdict on the construct — *"a value of unrepresentable
type: a symbol"* — and what it was was the absence of a file.

`nts/rt/NtsSymbol` is a `final String description` and a constructor. The
identity is the whole of it: two symbols with the same description are different
values, which is why it is a class and not a `String`, and why `NtsMap` keys it
through the `default` arm of `sameKey` — reference equality — rather than
through any of the tagged ones. That arm already existed.

Five operations, transliterated from `runtime/c`:

| | |
| --- | --- |
| `newSymbol(d)` | a fresh identity every time |
| `forKey(k)` | **interns** — every call after the first is the same object |
| `keyFor(s)` | walks the registry, and returns null for one never registered |
| `description(s)` | the description, or null |
| `describe(s)` | `Symbol(d)`, and `Symbol()` when there is none |

Two details carried across rather than reinvented:

- **`Symbol()` has no description, and that is not `Symbol("")`.** Both print
  `"Symbol()"`, and `.description` is `undefined` against `""`. So the field is
  nullable and the two are distinguishable only by reading it.
- **`keyFor` walks.** The registry maps key to symbol and this asks the other
  way; `runtime/c` says a second index would cost every `Symbol.for` a write to
  keep, and `Symbol.keyFor` is the rare direction. Same choice here, for the
  same reason, rather than a `HashMap` in the other direction that nobody asked
  for.

`examples/symbol-values` — twelve exported functions, seven `Symbol.for`, two
`Symbol.keyFor`, two `typeof` and a `String()` — **agrees with node on every
case**, which covers the interning, the identity, the tag and the formatting
without any of it having been aimed at.

## The floor

    jvm  110 of 110

Equal to the corpus, and the whole of the corpus. This lane now renders every
construct in it and agrees with node on all of them, by bit pattern.

`docs/conformance/typescript.md`'s JVM column has two rows to move as a result,
and that file is nts-69's; the message is sent.

## What is left, which is not coverage

Nothing in `tooling/gate/declines.sh`'s output — 110 examples and 50 bench
cases, and it prints nothing at all now. The work left on this lane is entirely
the column: twenty-two rows above 1.00x against hand-written Java, the largest
of them `node-utf8` at 11.87x, where a Java programmer writes `getBytes` and
gets a HotSpot intrinsic while we compile `runtime/node/internal/utf8.ts` a code
point at a time.

A floor equal to the corpus is also the point at which the floor stops being
informative. From here it can only be held: an example that does not agree fails
the step on the day it lands, rather than being absorbed into a gap that was
already there.
