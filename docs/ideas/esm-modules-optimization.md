For running speed, yes, it's close to the best you can do with ESM. The gains left are mostly in startup, plus some compile-time cost. One caveat up front: I haven't measured `module#init`'s size, its clang compile time or startup cost in this session, so everything below is reasoning to verify, not data.

**Why it's already cheap.** Node's loader has to:

- resolve specifiers at run time;
- keep module records, link them, and walk the graph;
- make namespace objects whose exports are reached through getters;
- compile each module's code at startup.

nts does all of that at compile time. Module-scope bindings are plain globals, calls between modules are direct and statically named, and the evaluation order is fixed into one function. Running it costs only the top-level statements themselves. The lazy `#evaluate` path stays cheap too: one state check and one job per `import()`.

**Where it could be better:**

1. **Evaluate pure initialisers at build time.** A deferred global like `const BASE64_VALUES = (() => { …build a 256-entry table… })()` is a zero in the binary, filled in at every startup. If the initialiser has no effects and doesn't depend on its environment, it could be computed at build time and emitted as static data. That saves startup work, and it lets later passes treat the value as a constant rather than a load from a global written at run time. It's the same idea as Wizer, or V8's snapshots. `runtime/node` is full of these tables.

2. **Treat "written only by module evaluation" as immutable after startup.** `global_is_settled` already computes that for the addon. The optimiser doesn't use it. A global written once during initialisation and never again could be folded and its loads hoisted in hot code. Today it's just a mutable global to every pass after lowering.

3. **Drop initialisers nothing reads.** ESM must run top-level side effects, but a pure initialiser for a binding no reachable code reads can go. Whole-program pruning covers functions, not module statements, so every eager module's statements run whether or not anything uses their results.

4. **Make `module#init` cheaper to compile, and keep it out of the hot path.** It runs once, yet it's one large function holding every eager module's statements. For big programs that's likely clang time spent optimising code that runs once, and cold code sitting next to hot code. Marking it cold or size-optimised, or emitting one function per module called in order, should cut compile time with no effect on running speed. That's worth measuring on the `runtime/node` modules.

5. **Lazy evaluation of static imports isn't available.** ESM requires eager evaluation in a fixed order, so making side-effect-free modules lazy would be an observable change except where analysis proves the difference unobservable. That would be a large effort for a small gain, so it's not worth pursuing.

Items 1 and 2 are the meaningful ones for startup and steady-state speed, and 4 is about compile time. None is on the plan's list today. Since performance is why this project exists, they'd be worth a measured entry: startup time and the size of `module#init` on the largest `runtime/node` modules, before and after.
