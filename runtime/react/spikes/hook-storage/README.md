# Hook storage: how one Fiber's heterogeneous hook list is represented

A component's hooks form a single ordered list. State hooks, reducer hooks,
effects and memo cells sit next to each other, and each `useState<S>` call
site reads back its own `S`. This spike asks which representation NTS lowers
when the runtime is written as ordinary TypeScript.

Every arm exports `renderTwice(next)` and agrees with node
(`clicks: 0 / clicks: 41`).

| Arm | Representation | `nts refusals` |
| --- | --- | --- |
| `a-unknown-assertion` | one `HookNode` class, `state: unknown`, read back with `as S` | **0** |
| `b-generic-subclass` | `StateHook<S> extends Hook`, projected with `instanceof StateHook` | 6 |
| `c-generic-subclass-guard` | as B, projected with a generic guard `hook is StateHook<S>` | 7 |

Measured on 2026-09-24 at nts `9f870e92`, from a pinned worktree build.

**B and C fail because of TypeScript, not NTS.** `instanceof` against a
generic class narrows to `StateHook<any>`. NTS refuses `any`, so `state`
reads as a member that `Hook` does not declare. The generic guard in C
additionally hits "a generic function no call pins down".

**A lowers the way we want.** `useState` is specialised for each
instantiation (`useState<f64>`, `useState<str>`). The write is an `erase` and
the read is an `unerase` to the instantiation's representation. The field is
the 16-byte `NtsValue`.

## The hazard A carries

The C backend's `unerase` is **unchecked**: `nts_value_number(v)` returns
`v.as.number` without checking the tag. Suppose a component changes its hook
order between renders. React's development build reports this and its
production build does not. The unchecked read is then type confusion. For a
reference type it is a memory-safety failure, not a wrong answer.

Consequences for the runtime:

- every `HookNode` carries its hook kind, and every hook checks the kind
  before projecting, in every build. This is stricter than production React,
  and we can observe it only as a thrown error where React would have
  misbehaved;
- the same kind with a different `S` at the same position (a conditional
  `useState<number>` swapped with a `useState<string>`) passes the kind check.
  Closing that needs either a checked `unerase` in a checking build or a type
  token per call site. That goes to the compiler lanes as a request, not as a
  runtime workaround.

## What A does not settle

Performance. A 16-byte erased slot per hook is the correct baseline. Typed
hook frames per component (M4) remove it once React Compiler and the
component's static hook order prove the layout.
