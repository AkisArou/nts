// A `let` in a loop head is block-scoped to the loop, at module scope too.
//
// `collect_module_scope` walks every `VARIABLE_DECLARATION` that is not inside
// a function and gives it a global. A `for (let i = …)` head is one of those
// nodes and is **not** a module binding — `let` is block-scoped, which is the
// whole difference between it and `var`.
//
// The global was never written. `lower_for` binds the head variable as a block
// parameter, and a closure in the body resolved the same name through module
// scope and emitted `global.get` against a slot nothing stores to:
//
//     let total = 0;
//     for (let i = 0; i < 3; i++) { const f = () => i; total += f(); }
//
// answered **0** where node answers **3**. The identical loop *inside a
// function* was always right, because there the collector never looked and the
// ordinary capture path ran — two derivations of where `i` lives, agreeing
// everywhere except the one place one of them had no business answering.
//
// **A wrong answer that runs**, found by a probe sweep against node.
// `nts check` cannot see it: its harness drives exported functions taking
// scalars, and this is a statement. The corpus cannot see it either — the
// census ranks refusals, and this compiled, ran and returned a number.
//
// # What the loop-capture rule is, and that this does not change it
//
// A closure over a `let` head captures **by value**, which is exact: the
// specification copies the binding before each iteration, so iteration k's
// binding keeps iteration k's value, and that value is what `i` holds where the
// closure is built. `rebinding_refusal` refuses the two cases where a copy is
// not exact — a `var` head, and a body that writes the name — and at module
// scope it was never asked, because there was no capture to ask about.

let byValue = 0;

for (let i = 0; i < 3; i++) {
  byValue = byValue + ((): number => i)();
}

export function capturedAtModuleScope(n: number): number {
  return byValue + n * 0;
}

const kept: (() => number)[] = [];

for (let i = 0; i < 3; i++) {
  kept.push((): number => i);
}

/**
 * Closures that **outlive their iteration**, which is the only shape that can
 * tell capture-by-value from one shared cell. An implementation that read the
 * loop's final value would answer `333`.
 */
export function outlivingTheIteration(n: number): number {
  return kept[0]() * 100 + kept[1]() * 10 + kept[2]() + n * 0;
}

let nested = 0;

for (let i = 0; i < 2; i++) {
  for (let j = 0; j < 2; j++) {
    nested = nested + ((): number => i * 10 + j)();
  }
}

/** Two heads, so a fix that skipped only the outermost would show here. */
export function twoHeads(n: number): number {
  return nested + n * 0;
}

const readers: (() => string)[] = [];

for (const word of ["a", "b"]) {
  readers.push((): string => word);
}

/** A `for...of` head, which is a different statement and the same scoping. */
export function aForOfHead(n: number): string {
  return readers[0]() + readers[1]() + (n < 1 ? "" : "!");
}

/**
 * The control: a module-scope `let` that is **not** in a loop head really is a
 * module binding, and a function must see writes to it. A fix that skipped
 * every module-scope declaration would pass every arm above and lose this one.
 */
let moduleBinding = 1;
moduleBinding = 2;

export function anOrdinaryModuleBinding(n: number): number {
  return moduleBinding + n * 0;
}

/** And the same binding read from a closure, which is the path under test. */
const readsTheBinding = (): number => moduleBinding;

export function aClosureOverAModuleBinding(n: number): number {
  return readsTheBinding() + n * 0;
}

// # `var` is not skipped, and that was learned the expensive way
//
// For one commit this skipped a `var` head too, reasoning that `lower_for`
// binds the head variable as a block parameter whatever the keyword, so the
// global was unwritten either way. **The census said otherwise**: three files
// that read the head's `var` *after* the loop —
//
//     for (var i = 0; i < 10; i++) {}
//     if (i !== 10) throw new Test262Error(...);
//
// — passed before and refused after. So the global *was* being written, and
// the claim that `var` "was already a local in every way except the one that
// produced the wrong answer" was false. `var` hoists; its head declaration
// really is a module binding.
//
// **The gate did not catch it and could not have**: no example reads a `for`
// head's `var` after the loop. A full census run did, by comparing 4,812 files
// against the same run a few commits earlier.
//
// What that leaves unfixed is a closure over a `for` loop's `var` at module
// scope, which answers the loop's first value rather than its last. That is
// the status quo rather than a regression, and the in-function case has a
// blocker of its own.
//
// # What still refuses, and why it is not this
//
// A `const` declared **inside a module-scope loop body** —
//
//     for (let i = 0; i < 3; i++) { const v = i; total += v; }
//
// — refuses with ``i`, a name from an enclosing scope``, and it refuses with
// no closure in it at all. `collect_module_scope` gives that `const` a global
// too, and its initializer is deferred to the top of `module#init`, where the
// loop's `i` does not exist. It is the same defect one level out: a
// declaration nested in a **block** at module scope is not a module binding
// either, and `is_within_a_function` is the wrong question to be asking.
//
// **Before this change it did not refuse — it read the unwritten global and
// answered 0.** So the shape moved from a wrong answer to a refusal, which is
// the direction to move in, and the arms here are written without it so that
// the fixture measures what it is named for.
