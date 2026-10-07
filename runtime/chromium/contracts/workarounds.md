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
| 5 | Lone surrogates are built with `String.fromCharCode`, not written as literals. | `tests/idl-vectors.ts` (USVString vectors) | blocker `a-lone-surrogate-in-a-string-literal` (Windows lane's): `"\uD800"` becomes three U+FFFD | the blocker reads FIXED | C |
| 7 | `setTimeout(handler)` and `setInterval(handler)` are separate `_default` C entry points, not an `@ntsDefault timeout=0`. | `dom/types/dom-abi.d.ts`, `dom/abi/dom_abi.h`, `adapter/dom_bridge.cc` | `@ntsDefault` takes only an integer, and the timeout is a `double` so ToInt32 is applied in the adapter | `@ntsDefault` accepts a floating-point default | C |
| 8 | A listener that removes itself is a `function` declaration, not a `const` arrow. | `tests/idl-vectors.ts`, `tests/timer-vectors.ts` | a closure capturing its own `const` ("captured above its own declaration") is refused | that capture compiles | C |
| 9 | Apps may not have module-level state; `app.ts build` refuses a program declaring `module__init`. | `tooling/chromium/app.ts` (`appEntry`) | request 10: module state is process-wide, environments are per document | request 10 delivered | C |
| 10 | Constructors are factory functions, `newURL(url, base)`, not `new URL(url, base)`. | generated `dom/types/dom-idl.d.ts` | `@ntsConstruct` has no positional form (it is GObject's object-literal construction); `new X(...)` is not in the lib.dom delegation table yet | `new X(args)` lowers to a bound constructor | C |
| 11 | The `onclick` getter (and every event handler attribute's) is not bound; only the setters are. | `tooling/chromium/bindgen/generate.py` (`event_handler`) | a foreign function cannot return a closure the program lent it | closure results from C | C |
| 12 | The `hidden` getter is not bound. | generator (`report.json`) | its Blink side builds a V8 value from a ScriptState; it needs a union result | a union result type, or a hand-written getter | L |
| 17 | Members taking `any` are not bound (`history.pushState(data, ...)`, `CustomEvent.detail`, `AbortController.abort(reason)` beyond its no-argument form). | generator (`report.json`) | a host function cannot take or return `any` | `any` crosses to C (an erased value with its tag) | C |
| 20 | An uncaught throw in a listener, a timer or an app's `main` ends the renderer (Chromium's crash page), and `console.*` writes to the process's stdout/stderr, not DevTools. The app examples and vectors throw nothing uncaught. | runtime, every callback | request 11: no host hook for console output or uncaught throws (`nts_uncaught` calls `exit(1)` inside a callback) | request 11 delivered, and the lane wires both into Blink | C |

## Waiting on shared tooling

| # | Workaround | Where | Cause | Remove when | Owner |
|---|---|---|---|---|---|
| 13 | `app.ts` reads `main`'s C symbol (`main_`) and its ownership from `program.h` comments. | `tooling/chromium/app.ts` (`appEntry`) | the `prefix` option of `library.staticNative` (`tooling/config/src/product.ts`) is documented but not applied | `prefix` works, or `program.h` names symbols in a machine-readable form | T |
| 14 | `app.ts` builds behind a generated `entry.ts` that re-exports the app's `main.ts`. | `tooling/chromium/app.ts` (`build`) | `nts build` takes native code only from the `nts.config.ts` above a program file, so a config beside the program cannot add `dom/abi` | a config can name native code for files outside its directory, or the target supplies the DOM ABI (the lib.dom overlay plan) | T |

## Lane debt (no external cause)

| # | Debt | Where | Remove when | Owner |
|---|---|---|---|---|
| 18 | Dictionaries bind as C structs written as object literals, so only members where zero means "left out" bind: booleans defaulting to false, numbers defaulting to 0. String, handle, sequence and enum members, and other defaults, are not bound (`report.json`); and an explicit `false` for a boolean with no default (`passive`) reads as left out, so `passive` is not offered. A dictionary with a required member it cannot carry does not bind at all; `attachShadow` is hand-written with the mode as its argument. | `tooling/chromium/bindgen/generate.py` (`dictionary`) | blocker `a-string-field-in-a-struct-argument` (a string field refuses the struct), and a presence bit per member (or optional fields) in `Fields<T>` | C |
| 16 | No release shell: apps run in the test-only `content_shell`-derived `nts_app` (served from their own origin, `nts-app://app/`, since M10). | `embedder/BUILD.gn` | a release shell target (no test-only deps, own branding) | L |
