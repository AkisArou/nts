// Module evaluation is a sequence of independent statements, and one of them
// being refused must not cost the others.
//
// It used to. `module#init` is lowered as a single function, so a statement
// calling something refused made the *whole* initializer a caller of a refused
// function, `drop_callers_of_refused` dropped it, every module-scope binding
// stayed at its zero, and every export reading one was dropped as reading an
// unwritten global. Twelve of the twenty-two modules in `runtime/node` lost
// their evaluation that way; `os` lost ten exports to one call at the bottom of
// the file, and `channel` darkened five modules by itself.
//
// What makes this example rather than a unit test is that node evaluates the
// whole module and this compiler does not, so the exports below have to agree
// anyway. That is the invariant: what survives the excision must compute what
// node computes, not merely exist.

// Refused: a regular expression literal needs an engine this compiler does not
// have yet. Everything downstream of `pattern` goes with it.
function classify(text: string): boolean {
  return /^[a-z]+$/.test(text);
}

const pattern = classify("abc");

// These do not depend on it, and must survive.
const base = 10;
const doubled = base * 2;
const label = "n=" + doubled;
const table: number[] = [1, 2, 3, 4];

// Not a loop. A module-scope loop that assigns a module-scope binding is
// refused -- "a loop assigning a name declared outside it" -- and its recovery
// is unsound in a way this file is not about: the statement is skipped, the
// global keeps its initial value, and the export reading it still compiles and
// disagrees with node. That is its own bug and its own fix.
const total = table[0] + table[1] + table[2] + table[3];

export function readDoubled(): number {
  return doubled;
}

export function readLabel(): string {
  return label;
}

// A global whose initializer reads another global. The point is that the
// *order* of the surviving statements is unchanged: excising one statement must
// not move the ones after it, or `total` is computed against a `table` that has
// not been assigned.
export function readTotal(): number {
  return total;
}

export function readFromTable(at: number): number {
  const index = at | 0;
  if (index < 0 || index >= table.length) {
    return -1;
  }
  return table[index];
}

// Not exported by name, but reachable: a function that reads a surviving global
// through another function. The cascade this file is about ran through calls as
// well as through globals.
function scaled(by: number): number {
  return doubled * by;
}

export function readScaled(by: number): number {
  return scaled(by | 0);
}

// The one that must NOT survive, and its refusal is the point. Nothing here
// compares it against node, because the compiled program has no such function
// -- which is the correct outcome and is what `nts hir` reports.
export function readPattern(): boolean {
  return pattern;
}
