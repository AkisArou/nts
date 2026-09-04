// `import def from "./m.js"`.
//
// The ledger had this as ✗ and it works — found by auditing the ledger against
// the compiler rather than by writing the feature, which is the point of the
// audit and the reason this example exists.
//
// There is nothing special about a default import at this level. `export
// default x` binds the name `default` in the module's namespace, and
// `import d from "./m.js"` imports that name under a local one — the same
// machinery as `import { x as d }`, which `examples/module-bindings` covers.
// What was missing was a fixture, so nobody could tell.

import scale, { offset } from "./values.js";
import twice from "./twice.js";
import bump, { seen } from "./counter.js";

// A default-imported constant, beside a named one from the same module.
export function aValue(n: number): number {
  return n * scale + offset;
}

// A default-imported function, called.
export function aFunction(n: number): number {
  return twice(n);
}

// A default import renamed at the import site, which is the whole of what a
// default import is: the local name is chosen by the importer.
export function renamed(n: number): number {
  return twice(n) + scale;
}

// A default import that reads and writes module state, so the two imports of
// one module see the same global rather than a copy.
export function throughState(n: number): number {
  const step = n > 0 && n < 100 ? n | 0 : 3;
  const first = bump(step);
  const second = bump(step);
  return first * 1000 + second + seen() * 1000000;
}
