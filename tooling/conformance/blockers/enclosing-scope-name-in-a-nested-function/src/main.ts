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
