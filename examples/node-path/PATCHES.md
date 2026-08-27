# The patch budget

`src/main.ts` is `node:path`'s posix half, ported from node `v24.20.0`
`lib/path.js`. The rule was: **a body is transcribed, a scaffold is replaced.**
Where a body had to change, the change is marked `PATCH(n)` in the source and
counted here.

The count is the point. Record 0011 lists what this compiler cannot lower; this
says what each of those costs in edits to one real module, so the work can be
ordered by price rather than by intuition.

## Scope

Ported: `normalizeString`, `normalize`, `isAbsolute`, `dirname`, `basename`,
`extname`, `join` (as `join2`). Not ported: `resolve` and `relative` (need
`process.cwd()`, so there is no deterministic oracle), `format` and `parse`
(need object types with optional properties, which is a refusal rather than
something a patch can route around).

## What it cost

| # | patch | forced by | sites |
| --- | --- | --- | ---: |
| 1 | `primordials` destructuring → plain function declarations | module-scope binding patterns are refused | 1 |
| 2 | `break` → a `stop` flag and a guarded body | `break` is refused | 4 |
| 3 | `continue` → a `handled` flag, or the `else` it implied | `continue` is refused | 3 |
| 4 | template interpolation → `+` | interpolated templates are refused | 4 |
| 5 | object-literal methods → free exported functions | a module-scope object literal lowers to nothing, and is not refused either | 6 |
| 6 | `validateString(…)` dropped | a runtime check on `any`; the parameter is `string` here | 6 |
| 7 | `path[i]` → `charCodeAt(path, i)` | string indexing; upstream itself uses `charCodeAt` everywhere else in the file | 1 |
| 8 | `basename`'s `suffix` parameter dropped | `suffix?: string` is a union with `undefined`, which is refused | 1 |
| 9 | `join(...args)` → `join2(a, b)` | rest parameters and a growable array | 1 |
| 10 | named predicate → an arrow wrapping it | a call of a function value is refused in a program containing no closure | 1 |
| 11 | `s += t` → `s = s + t` | **a compiler bug**, not a missing feature — see below | 3 |

Twenty-eight edits before the module of 1713 lines — reduced to the seven
functions above — compiles.

## Reading the table

Rows 2, 3 and 4 are twelve of the twenty-eight, and all three are ordinary
JavaScript control flow with no design questions attached. They are the cheapest
thing on the list to fix and would delete nearly half the patches by themselves.

Row 5 is six edits and is *also* the silent-drop bug in record 0011: upstream's
`posix = { normalize(…) {…}, … }` produces no HIR and no diagnostic. Row 1 is
one edit here but stands in front of all 372 files, because every one of them
opens by destructuring `primordials`.

Rows 6, 8 and 9 are not compiler gaps in the same sense. Row 6 is a genuine
behavioural difference — this port does not throw `ERR_INVALID_ARG_TYPE` on a
non-string argument, because its parameters are typed. Rows 8 and 9 are coverage
lost rather than behaviour changed: `basename(p, ext)` and variadic `join` are
absent, not wrong.

## Row 11 is a bug and should be filed separately

```ts
export function f(a: string, b: string): string {
  let s = a;
  s += b;
  return s;
}
```

lowers to `%2 = add %0, %1 : managed<str>`, which the C backend emits as
`v2 = v0 + v1` — pointer arithmetic on `NtsString *`, and clang refuses it. The
same expression written `s = s + b` lowers to `concat` and is correct.

`binary_operator` in `hir/lower.rs` selects `BinOp::Concat` for `PLUS_TOKEN`
when the type is managed. `compound_operator`, a few lines below it, maps
`PLUS_EQUALS_TOKEN` to `BinOp::Add` unconditionally and never asks the type.

It fails loudly at the C compiler rather than producing a wrong answer, which is
the good version of this bug. But it means no program that appends to a string
with `+=` can be built, and `examples/strings` does not do that, which is why
nothing had caught it.

## The two gates

Neither of these is worth much without the other.

- `node fidelity.mjs` runs this port and node's own `path.posix` on the same
  engine over 48 awkward paths — 2856 cases. It is what makes "we compiled
  node's path" a true sentence rather than a claim about a file that compiles.
- `nts check examples/node-path/tsconfig.json` runs the *compiled* program and
  node against each other. It is what makes it a statement about the compiler.

Both agree on every case.
