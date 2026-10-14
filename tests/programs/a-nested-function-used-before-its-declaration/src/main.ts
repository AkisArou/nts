// A function declaration is **hoisted**, so a nested one that captures can be
// read before it stands -- and its closure has to exist by then. Lowering built
// it where the declaration was, so the read fell through to the function-value
// wrapper, and that wrapper forwarded to the declared name, which for a
// capturing nested function is not a function of this program. `Closure1#call`
// calling `inner`, "which nothing in this program defines", with no root
// diagnostic: the same silence `3cf606cea` closed, one arm over.
//
// The GTK lane found it porting Workbench's Box, where GJS writes
// `button.connect("clicked", append)` above `function append() {...}`. That
// order is the idiomatic one, and the reverse order compiled all along -- so the
// order was load-bearing where the language says it is not.

function run(f: () => number): number {
  return f();
}

/** The reported shape: read as a value before its own declaration. */
export function usedBeforeDeclared(n: number): number {
  const got = run(inner);
  function inner(): number {
    return n * 2;
  }
  return got + inner();
}

/** Called rather than passed, which reaches the same binding by another route. */
export function calledBeforeDeclared(n: number): number {
  const first = inner();
  function inner(): number {
    return n + 1;
  }
  return first + inner();
}

/**
 * The bound the hoist must not cross, and it is a **wrong answer** rather than a
 * refusal if it does.
 *
 * `inner` captures `later`, which is declared inside this block, so at the top of
 * the block there is nothing to capture. node throws here --
 * `ReferenceError: Cannot access 'later' before initialization`, since `inner` is
 * hoisted and `later` is in its temporal dead zone -- and a closure built at the
 * top would read the cell before anything wrote it and **answer `NaN`**, which is
 * measured rather than feared: that is what it did before `hoistable` was
 * narrowed. It refuses instead, as
 *
 *     NTS1001 `inner`, a function used as a value
 *
 * at the *use*, which is the one row this example contributes to
 * `tooling/gate/example-refusals`. That sentence is true and general rather than
 * specific to the dead zone; saying "read before its declaration, and it captures
 * a binding declared after the top of the block" needs that context at the read,
 * and `FuncBuilder::hoistable` is where it is written down instead.
 *
 * `Capture::forward` was the first guard written for this and does not fire:
 * `later` is declared *above* `inner`, so "declared below this declaration" is
 * false while "declared inside this block" is true. The fixture had the arm
 * before the guard did.
 */
export function capturesFromInsideTheBlock(n: number): number {
  const got = run(inner);
  let later = n + 1;
  function inner(): number {
    return later * 3;
  }
  later = n + 10;
  return got + inner();
}

/** The control that already worked: declared above every use. */
export function declaredFirst(n: number): number {
  function inner(): number {
    return n * 5;
  }
  return run(inner) + inner();
}
