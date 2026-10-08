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
| 8 | A listener that removes itself is a `function` declaration, not a `const` arrow. | `tests/idl-vectors.ts`, `tests/timer-vectors.ts` | a closure capturing its own `const` ("captured above its own declaration") is refused: blocker `a-closure-that-passes-itself-on` (still reproduces on main b62243224) | that capture compiles | C |
| 9 | Apps may not have module-level state; `app.ts build` refuses a program declaring `module__init`. | `tooling/chromium/app.ts` (`appEntry`) | request 10: module state is process-wide, environments are per document | request 10 delivered | C |
| 11 | An event handler attribute (`onclick`) is read back through its getter's method (`el._get_onclick()`), not the property, and only under nts:dom's types; lib.dom's read is not in the vectors. | `tests/idl-vectors.ts` (`handlerRead`); the lib.dom vector is parked | blockers `a-closure-typed-property-read` (a Closure-typed `@ntsGet` property read: invalid HIR) and `lib-dom-event-handler-read-back` (the same through lib.dom; then a read narrowed to `null` is refused) | fixed: read the property, and add the lib.dom read-back vector (`onclickRead`) | C |
| 12 | The `hidden` getter is not bound. | generator (`report.json`) | its Blink side builds a V8 value from a ScriptState; it needs a union result | a union result type, or a hand-written getter | L |
| 17 | Members taking `any` are not bound (`history.pushState(data, ...)`, `CustomEvent.detail`, `AbortController.abort(reason)` beyond its no-argument form). | generator (`report.json`) | a host function cannot take or return `any` | `any` crosses to C (an erased value with its tag) | C |
| 20 | An uncaught throw in a listener, a timer or an app's `main` ends the renderer (Chromium's crash page), and `console.*` writes to the process's stdout/stderr, not DevTools. The app examples and vectors throw nothing uncaught. | runtime, every callback | request 11: no host hook for console output or uncaught throws (`nts_uncaught` calls `exit(1)` inside a callback) | request 11 delivered, and the lane wires both into Blink | C |
| 26 | The lib.dom vectors call `window.fetch(url)`, not the global `fetch(url)`; RequestInit's `method` is exercised through nts:dom (`newRequest`) in `idl-vectors.ts`, not through lib.dom. | `tests/lib-dom-vectors.ts` (`settleFetch`), `tests/idl-vectors.ts` (`requestInit`) | blockers `lib-dom-global-fetch-is-taken-as-a-builtin` (the global is refused as a builtin) and `lib-dom-dictionary-with-a-string-member` (a lib.dom dictionary with a string member) | both fixed: call `fetch`, and move the method vectors (and a rejected `fetch(url, { method })`) to lib.dom | C |
| 27 | Vectors compare a DOM exception as "Name: message": the program catches an `Error` (name "Error") whose message is "TypeError: ..." or "NotFoundError: ...", where page script catches the named error (`TypeError`, a `DOMException` named `NotFoundError`). | `tests/lib-dom-vectors.ts` (`failure`), `tooling/chromium/smoke.ts` and `tests/dom-witness.ts` (each side's `failure`) | `@ntsThrows` throws a plain `Error` carrying the converter's message: request 15 | a reported error can be thrown as a class the converter names, with its `name` | C |

## Waiting on shared tooling

| # | Workaround | Where | Cause | Remove when | Owner |
|---|---|---|---|---|---|
| 13 | `app.ts` reads `main`'s C symbol (`main_`) and its ownership from `program.h` comments. | `tooling/chromium/app.ts` (`appEntry`) | the `prefix` option of `library.staticNative` (`tooling/config/src/product.ts`) is documented but not applied | `prefix` works, or `program.h` names symbols in a machine-readable form | T |

## Lane debt (no external cause)

| # | Debt | Where | Remove when | Owner |
|---|---|---|---|---|
| 18 | Dictionaries bind as C structs written as object literals, so only members where zero or NULL means "left out" bind: booleans defaulting to false, numbers defaulting to 0, and strings and enums (StringView fields, since main 1c0cd8208). Handle, sequence and nullable members, and other defaults, are not bound (`report.json`); an explicit `false` for a boolean with no default (`passive`) reads as left out, which is why `passive` is a trailing argument of its own `addEventListener` overload (`nts_dom_add_event_listener_passive`), the overload without it leaving it to Blink's default. | `tooling/chromium/bindgen/generate.py` (`dictionary`) | a presence bit per member (or optional fields) in `Fields<T>`, and handle fields | C |
