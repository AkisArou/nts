# Fiber state: typing a field whose content depends on the fiber's tag

A fiber's `memoizedState`, `stateNode` and `updateQueue` hold different
things for different work tags. Every possible content is a class the
reconciler owns (a `Hook` list, a `SuspenseState`, an `OffscreenState`...),
so none of them should be `unknown`. The question is which typed
representation NTS lays out best.

Measured with `nts layouts` and `nts hir` at `8e8ecc2e`. All arms agree with
node on `run`.

| Arm | Field type | Layout | Read |
| --- | --- | --- | --- |
| U | `Hook \| SuspenseState \| OffscreenState \| null` | `Erased`, 16 bytes | `instanceof`, then `unerase` |
| B | `FiberState \| null`, an abstract base class | `Managed(Object)`, an 8-byte pointer | **refused**: no downcast from a base class after `instanceof`, not even with `as` |
| F | one typed field per kind (`hooks`, `suspenseState`) | 8-byte pointers | direct field load and a null check |

Decision: tag-dependent fibre fields become sealed base-class hierarchies
(arm B). Each field is one pointer, and each read is a checked `instanceof`
downcast: one descriptor compare, with no tag word and no erased slot.
Arm F is the fastest read, but it costs 8 bytes on every fibre for every
extra kind. Arm U is no better than `unknown`.

Arm B needs one compiler feature: after `x instanceof Sub`, where `x` is typed
as a base class, NTS must lower member access on `x` as `Sub`. The `instanceof`
test already exists, so this is a narrowing rule. The reduced case is
`readB` in `src/main.ts`.
