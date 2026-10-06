# Workarounds in the Chromium lane

Every place where the lane's code is shaped around something that should not
have to be there: a compiler defect, a missing compiler feature, or a tooling
gap. Each row says where the workaround lives, its cause (a gated fixture
under `tooling/conformance/blockers/`, or a request in
[compiler-requests.md](compiler-requests.md)), and what removes it. When the
cause is fixed, remove the workaround and delete the row in the same commit.

Owners: **C** = compiler lane (MainClaude), **L** = this lane, **T** =
shared tooling.

## Waiting on the compiler

| # | Workaround | Where | Cause | Remove when | Owner |
|---|---|---|---|---|---|
| 1 | The lane builds with the compiler from before landing-1 (`/tmp/claude-1000/nts-host`, built 2026-10-06 00:20), not main's. | every build and smoke | blocker `a-non-null-assertion-on-a-host-handle-is-refused`: `asX(...)!` is refused since 20eaa7d74 | the fix (c751af486) is on main; rebuild, re-run everything | C |
| 2 | Nullable text read through a parameter (`shown(value: string \| null)`), not where it was narrowed. | `tests/idl-vectors.ts` (`shown`) | request 9: a narrowed accessor read loses its null check (SEGV) | MainClaude says §9 is fully fixed | C |
| 3 | The C wrappers retain a handle before passing it to an export (`nts_dom_retain(setup->tbody)`). | `embedder/probe.c` (`create_rows`), `benchmarks/standalone/driver.c` | exports took over their arguments; landing a2 makes them borrow | a2 is on main | C |
| 4 | The fuzz is three straight calls, not a loop over the seeds. | `tests/idl-vectors.ts` (`idlTranscript`) | blocker `an-owned-handle-used-in-a-loop-is-never-released` (fixed on a2) | a2 is on main; also set the fixture's `once-c` count to 2 | C |
| 5 | Lone surrogates are built with `String.fromCharCode`, not written as literals. | `tests/idl-vectors.ts` (USVString vectors) | blocker `a-lone-surrogate-in-a-string-literal` (Windows lane's): `"\uD800"` becomes three U+FFFD | the blocker reads FIXED | C |
| 6 | Closures passed to `thrown()` have block bodies (`() => { d.querySelector("["); }`), never an expression answering a handle. | `tests/dom-witness.ts`, `tests/idl-vectors.ts` | blocker `a-handle-returning-closure-called-as-void`: aborts in `nts_refused` (fixed on a2) | a2 is on main | C |
| 7 | `setTimeout(handler)` and `setInterval(handler)` are separate `_default` C entry points, not an `@ntsDefault timeout=0`. | `dom/types/dom-abi.d.ts`, `dom/abi/dom_abi.h`, `adapter/dom_bridge.cc` | `@ntsDefault` takes only an integer, and the timeout is a `double` so ToInt32 is applied in the adapter | `@ntsDefault` accepts a floating-point default | C |
| 8 | A listener that removes itself is a `function` declaration, not a `const` arrow. | `tests/idl-vectors.ts`, `tests/timer-vectors.ts` | a closure capturing its own `const` ("captured above its own declaration") is refused | that capture compiles | C |
| 9 | Apps may not have module-level state; `app.ts build` refuses a program declaring `module__init`. | `tooling/chromium/app.ts` (`appEntry`) | request 10: module state is process-wide, environments are per document | request 10 delivered | C |
| 10 | Constructors are factory functions, `newURL(url, base)`, not `new URL(url, base)`. | generated `dom/types/dom-idl.d.ts` | `@ntsConstruct` has no positional form (it is GObject's object-literal construction); `new X(...)` is not in the lib.dom delegation table yet | `new X(args)` lowers to a bound constructor | C |
| 11 | The `onclick` getter (and every event handler attribute's) is not bound; only the setters are. | `tooling/chromium/bindgen/generate.py` (`event_handler`) | a foreign function cannot return a closure the program lent it | closure results from C | C |
| 12 | The `hidden` getter is not bound. | generator (`report.json`) | its Blink side builds a V8 value from a ScriptState; it needs a union result | a union result type, or a hand-written getter | L |

## Waiting on shared tooling

| # | Workaround | Where | Cause | Remove when | Owner |
|---|---|---|---|---|---|
| 13 | `app.ts` reads `main`'s C symbol (`main_`) and its ownership from `program.h` comments. | `tooling/chromium/app.ts` (`appEntry`) | the `prefix` option of `library.staticNative` (`tooling/config/src/product.ts`) is documented but not applied | `prefix` works, or `program.h` names symbols in a machine-readable form | T |
| 14 | `app.ts` builds behind a generated `entry.ts` that re-exports the app's `main.ts`. | `tooling/chromium/app.ts` (`build`) | `nts build` takes native code only from the `nts.config.ts` above a program file, so a config beside the program cannot add `dom/abi` | a config can name native code for files outside its directory, or the target supplies the DOM ABI (the lib.dom overlay plan) | T |

## Lane debt (no external cause)

| # | Debt | Where | Remove when | Owner |
|---|---|---|---|---|
| 15 | `smoke.ts` and `benchmark.ts` each carry their own launch-and-DevTools code; `tooling/chromium/browser.ts` is the shared one. | `tooling/chromium` | both move onto `browser.ts` | L |
| 16 | The lane is on file URLs and the test-only `content_shell` targets; no packaged origin or release shell. | `host/app_main.cc`, `embedder/BUILD.gn` | packaging milestone | L |
