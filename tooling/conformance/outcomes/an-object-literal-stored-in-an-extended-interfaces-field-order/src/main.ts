// An object literal typed as an interface whose own members are declared
// *after* the ones it inherits -- `interface R extends Required<Omit<O, "a">>
// { a: ... }` -- is stored field by field in the literal's order into a layout
// in another order. The layout puts R's own members first; the stores follow
// the literal. Reduced from runtime/node/util's `inspectDefaultOptions`.
//
// **Artefact, runtime/node/url on 41dd45663** (`nts hir --prepared`), the
// `ResolvedInspectOptions` literal `{ depth: 2, colors: false, showHidden:
// false, breakLength: 80, compact: 3, ... }`:
//
//     field.set %3132.1 = erase (const false)     -- slot 1 is maxArrayLength
//     field.set %3132.2 = erase (const false)     -- slot 2 is maxStringLength
//     %3666 = convert (const 80 : f64) : bool
//     field.set %3132.3 = %3666                    -- slot 3 is colors
//     %3667 = unerase (erase (const 3)) : bool     -- compact's 3, as a bool
//
// so the runtime's defaults have `colors` true and `maxArrayLength` false on
// every backend: C and LLVM store it without a word. There the HIR passed the
// validator because a coercion had been inserted at each store; reduced, it
// does not, and every backend refuses:
//
//     invalid HIR: [StoreType { func: "module#init", what: "a field read",
//     expected: Erased, found: Bool }, StoreType { ... expected: Bool, found:
//     Float { bits: 64 } }, StoreType { ... expected: Float { bits: 64 },
//     found: Erased }]
//
// It is also the only `convert <number> : bool` in the runtime, and what
// exposed the JVM's frame defect (D) in url's `module$init`.
//
// **Control, measured:** the same program with `Resolved` declaring all four
// members in its own body, no `extends`, builds and agrees with node.
//
// **Expected, confirmed under node:** colors=false, breakLength=80,
// maxArrayLength=100, depth=2.
interface Options {
  depth?: number | null;
  colors?: boolean;
  breakLength?: number;
  maxArrayLength?: number | null;
}

interface Resolved extends Required<Omit<Options, "depth" | "maxArrayLength">> {
  depth: number | null;
  maxArrayLength: number | null;
}

const defaults: Resolved = {
  depth: 2,
  colors: false,
  breakLength: 80,
  maxArrayLength: 100,
};

observe("colors", String(defaults.colors));
observe("breakLength", String(defaults.breakLength));
observe("maxArrayLength", String(defaults.maxArrayLength));
observe("depth", String(defaults.depth));
done();
