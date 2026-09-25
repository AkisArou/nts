// Several generic functions instantiated at the **same type**, each holding a
// closure that captures a parameter.
//
// A copy's name carries what it binds and not what it is a copy *of*, so
// `first<S>(v: S)`, `second<S>(v: (() => S) | S)`, `third<S>(v: S[])` and
// `fourth<S>(v: S)` all spell their `number` copy `<f64>`. `Shared::class_copies`
// was keyed by that string alone, so three of these four copies were dropped from
// it, `class_closure_variants` made a closure variant only for the survivor, and
// the other three closures were lowered with an **empty substitution** -- reading
// their captures at the declaration's types and refusing with
//
//     a captured variable of unrepresentable type (the type parameter `S`)
//
// Which one survived was decided by node order, so moving a declaration in the
// file moved the refusal to a different function. That is the tell this fixture
// exists to keep: a refusal whose identity depends on declaration order is a
// collision in a key, not a gap in a feature.
//
// **It lost a copy rather than assigning a wrong one**, and that was luck rather
// than design: `class_closure_variants` pairs a closure only with a copy of its
// own declaration, so the surviving entry could never lend its substitution to
// someone else's closure. Had that guard not been there, the same collision would
// have read a capture at another generic's binding, which is a type confusion no
// backend can see. The copy now travels with the variant that needs it, so the
// question is not asked a second time.
//
// # What each export earns
//
//     one          the first declaration, which compiled before this too
//     two, twoThunk  the second, at both arms of its union, so the copy is
//                  reached through a narrowing and not only through a value
//     three        the third, whose parameter is `S[]` -- a different written
//                  type reaching the same suffix, which is what makes the
//                  collision a collision rather than a duplicate
//     four         the fourth, so the count is three lost copies and not one
//     text         `first` again at `string`, so two suffixes exist for one
//                  declaration and the pair is exercised in both directions
//
// Every arm's answer depends on its argument, so a copy made under the wrong
// substitution would have to be wrong about a value and not merely absent.
//
// **The arithmetic is deliberately on a `number` parameter and never on the
// narrowed `S`**, and the reason is a second defect this fixture found and does
// not measure. Eight lines:
//
// ```ts
// function bare<S>(value: S): number {
//   const held: S = value;
//   return typeof held === "number" ? held * 2 : 0;
// }
// export function bareText(word: string): number { return bare(word); }
// ```
//
// `bare<str>` emits the multiply with a string operand -- `OperandsDiffer { op:
// "*", left: Managed(String), right: Float }` -- and `verify` rejects the whole
// program. The narrowing is the declaration's, where `S` could be a number; in a
// copy that binds `S` to something else the branch is statically dead and is
// emitted anyway. It has no fixture of its own because neither harness can hold
// it: a blocker whose `emit-c` writes no `program.c` counts as **not measured**
// and fails the gate, and the corpus's `invalid HIR` column is a floor at zero.
// So it is written here, next to the shape that produces it, until it is fixed.

function render(component: () => number): number {
  return component();
}

function first<S>(value: S, bump: number): number {
  function read(): number {
    const held: S = value;
    return typeof held === "number" ? bump * 2 : bump + 1;
  }
  return render(read);
}

function second<S>(value: (() => S) | S): number {
  function read(): number {
    return typeof value === "function" ? 1 : 2;
  }
  return render(read);
}

function third<S>(value: S[]): number {
  function read(): number {
    const held: S[] = value;
    return held.length;
  }
  return render(read);
}

function fourth<S>(value: S, bump: number): number {
  function read(): number {
    const held: S = value;
    return typeof held === "number" ? bump + 7 : bump - 7;
  }
  return render(read);
}

export function one(start: number): number {
  return first(start, start);
}

export function two(start: number): number {
  return second(start);
}

export function twoThunk(start: number): number {
  return second(() => start);
}

export function three(start: number): number {
  return third(start > 0 ? [start] : [start, start]);
}

export function four(start: number): number {
  return fourth(start, start);
}

export function text(word: string): number {
  return first(word, word.length);
}
