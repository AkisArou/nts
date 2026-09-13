// expect: a name from an enclosing scope
//
// A nested function reading a local of the function that declares it.
//
//     function outer(columns) { function inner(i) { return i * columns; } }
//                                                       ^ REFUSED
//
// `control` takes the same value as a parameter and does the same arithmetic,
// so what is refused is the capture and not the multiplication. Without it the
// diagnostic reads as "nested functions are not supported", which is false --
// `unread` below is nested too, reads nothing from around it, and lowers.
//
// One of `path`'s six own-source roots, at `src/glob-matcher.ts:596`. `visit`
// is a recursive matcher closing over `columns` and `memo` from the function
// that built them; both are locals of the caller, and there is no spelling of a
// memoised recursive match that does not read them.
//
// # This message had a second cause until 2026-09-10, and it was the larger
//
// `is_within_a_function` did not know `ARROW_FUNCTION`, `FUNCTION_EXPRESSION`
// or the accessors, so a `const` declared in one of those became a module-scope
// global and its initializer was lowered in `module#init` -- where the
// enclosing function's parameters really are out of scope. `const f = (k) =>
// { const c = k + 1; return c; }` reported this exact sentence about `k`, the
// arrow's own parameter.
//
// So a census grouping by message counted those together with these, and the
// two have nothing in common: one was a wrong answer about scope and the other
// is a capture this compiler does not lower. **This fixture was the whole of
// what the message should ever have meant**, and it was a minority of what it
// said. See record 0267 -- the tell was that fixing part of a message's count
// at a different site left the rest saying the same words.

// # It is a desugaring, not a feature — established 2026-09-13
//
// The machinery is **entirely present**. The same function written as a
// const-bound expression, or as an arrow, lowers and agrees with node:
//
//     function outer(columns) {
//       function visit(i) { return i * columns }      REFUSED
//       const visit = function (i) { return i * columns }   lowers
//       const visit = (i) => i * columns                    lowers
//     }
//
// 58 cases across the two working forms. So a nested `function` declaration is
// exactly a **hoisted `const` binding to a function expression**, and what is
// missing is the desugaring rather than any capture machinery.
//
// # Five coordinated places, which is why it is not three lines
//
//   1. `collect_closures`'s `is_closure` — include a nested declaration.
//   2. `reached_by_name` — **exclude** it. That predicate returns `true` for any
//      symbol declared by a `FUNCTION_DECLARATION`, on the reasoning that "there
//      is one of it for the whole program, so copying a pointer to it into every
//      closure would be storage for nothing". True at module scope and false for
//      a nested one, which is a per-call binding.
//   3. The named-declaration collection loop — skip it, so no top-level function
//      is emitted for a body that now reads captures.
//   4. The statement walk — bind the closure where the declaration stands, and
//      **hoisted**, because a function declaration is usable before its textual
//      position and a `const` is not.
//   5. Call sites — resolve the name to that binding rather than to a global.
//
// Each of those five carries a comment explaining why it is as it is, and each
// is right about module scope. The distinction they all lack is the same one.
//
// # The corpus shape, so the lever is chosen on evidence
//
// 48 nested function declarations in `runtime/node`; **20 are used as a value**
// beyond their declaration and 17 mention `this` nearby. So *lambda lifting* —
// adding the captured values as parameters and rewriting direct calls, which
// needs no closure at all and is cheaper at run time — reaches at most half of
// them, and the desugaring above reaches all. `closeHandler` and `errorHandler`
// in `events` are stored and called later; `visit` below is not.
//
// 20 things, 33 sites, 17 modules — the eighth cause in the refusal census.
//
// # Attempted 2026-09-13, reverted, and here is how far it got
//
// Four of the five were written and each did what it was meant to. Instrumented
// rather than inferred, because each step's failure looked like the previous
// step not having worked:
//
//     collect_closures     takes it       `visit` within=true this=false -> true
//     bind_nested_function fires          in-closures=true
//     lower_arrow          allocates      and pushes `used_closures`
//     declaration loop     skips it       no top-level function is emitted
//     the call site        STILL DIRECT   `viaDeclaration ... calls `visit`,
//                                         which was refused above`
//
// So there is a **sixth** place. The call `visit(2)` still resolves to a direct
// call to a name no longer emitted, and adding a `bindings.contains_key` test
// beside `names_a_declared_function` in `lower_call` did not change it — which
// means the callee's symbol at the call site is not the symbol the binding was
// inserted under, or the call is resolved before that test. That is the next
// thing to find, and it is one `eprintln!` away.
//
// The closure body is also not emitted (`Closure1` and `Closure2` exist, from
// the two working forms; `Closure0` does not), so `wanted` is not reaching it
// either — plausibly the same cause, since nothing calls it.
//
// **Reverted rather than left half-applied.** Four coordinated edits that make
// a program refuse *differently* are worse than one that refuses the way the
// row says, and the corpus counts did not move.
//
// # The obvious lever is not one, measured 2026-09-13
//
// `collect_closures` matches `ARROW_FUNCTION` and `FUNCTION_EXPRESSION` and not
// `FUNCTION_DECLARATION`, so adding the third looks like the fix — a nested
// `function` differs from a nested function *expression* only by being hoisted
// and named, and neither is a difference about capture.
//
// Adding it changes **nothing**: `util` and `net` report the same refusal counts
// to the line. A function declaration's emission path does not consult that
// list, so making it a closure there gives it no closure to be. The work is in
// the emission — a nested declaration that captures has to become a closure
// object allocated in its enclosing function, with its call sites dispatching
// through it — and `ClosureStatic` is the shape that already exists for "a named
// function used as a value".
//
// Recorded because the change is three lines and reads as obviously right, so
// the next person will try it too.

export function control(columns: number, index: number): number {
  return index * columns;
}

export function unread(): number {
  function inner(index: number): number {
    return index * 2;
  }
  return inner(3);
}

export function subject(columns: number): number {
  function visit(index: number): number {
    return index * columns;
  }
  return visit(2);
}
