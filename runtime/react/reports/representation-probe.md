# Hook-state representation probe

Measured with NTS commit `70522ab7491986072f2d719862702c03c5e51106`
from a shared working tree on Linux x86-64, Intel Core i9-14900K. The harness
uses GCC 16.2.1 with `-O3 -fno-lto`; each sample performs 100 calls of one
million loop iterations. Raw samples remain under the ignored
`generated/representation` directory.

## Layout

NTS lowers a `number` hook state field to `i32` in this fixture and a
`number | string` field to the existing `Erased` representation. The emitted C
layout is:

| Shape | Object bytes | State field bytes | Read in HIR |
| --- | ---: | ---: | --- |
| two typed state fields | 32 | 4 each | direct `field.get` |
| two erased state fields | 56 | 16 each | `field.get`, `tag.of`, `unerase` |

The erased hook costs 24 extra bytes for two fields. This matters for Fiber and
hook-list cache density even when arithmetic throughput is unchanged.

## Timing

| Case | Typed median | Erased median | Median ratio |
| --- | ---: | ---: | ---: |
| one loop-invariant state | 33.84 ms | 33.78 ms | 1.0005x |
| alternating exported inputs | 34.17 ms | 33.99 ms | 0.9958x |

HIR contains the expected tag test and unbox. In the invariant case GCC hoists
them completely. In the alternating case the inputs reach the generated
translation unit as opaque `NtsValue` arguments, but the tag test is cheap next
to the loop's parity operation and remains within measurement noise here. This
microbenchmark does not contradict the repository's larger erased-array
measurement, which isolates a per-element tag test and reports an 11% cost in
`docs/records/0019-what-the-erased-values-actually-do.md`.

## Consequence for React

Use NTS erased values for places whose semantics are truly heterogeneous: a
Fiber's arbitrary component, a general hook-list node and a renderer boundary.
Do not force every component-local hook or compiler cache slot into that
layout. A component-specific hook frame and a typed cache tuple reduce memory
traffic and let HIR avoid tags without depending on the backend optimizer.

Generics help the update path once a component or hook kind is known, for
example `StateQueue<number>`. They cannot give one concrete type to the single
linked list that React uses to hold state hooks, effect hooks and memo hooks.
That list still needs an existential boundary or a specialized replacement.
