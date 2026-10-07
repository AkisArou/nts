# Chromium: compiled TypeScript in the renderer

TypeScript compiled ahead of time to native code, running inside a Chromium
renderer and driving Blink's DOM directly: no V8 call per DOM operation, no
wrapper objects, page script's semantics. V8 stays in the page, fully
enabled, for whatever script the page has. The design, with its evidence, is
[docs/architecture.md](docs/architecture.md); the pinned source build and
the tools are in [`third_party/chromium`](../../third_party/chromium/README.md)
and [`tooling/chromium`](../../tooling/chromium). Linux x86-64, opt-in, and
independent of the ordinary compiler build.

## What a program can use

`nts:dom` is generated from Blink's IDL ([docs/lib-dom.md](docs/lib-dom.md)
lists how lib.dom.d.ts spellings map): the DOM and its events, forms and
validation, ranges and the selection, stylesheets, shadow DOM and slots,
the window (computed style, media queries, history, location, navigator,
performance), URL, AbortController, parsing and serializing, drag data,
the 2D canvas, and IDL enums as literal unions. About 4,500 members bind;
what does not yet is listed with its reason in
`tooling/chromium/bindgen/report.json`, and every workaround in
[contracts/workarounds.md](contracts/workarounds.md).

## Writing an app

An app is a directory with an `index.html` that opts in with
`<meta name="nts-app">` and a `main.ts` that exports `main(document:
Document)` (and, if it needs one, `unload()`), written against `nts:dom`:

```ts
import { setTimeout } from "nts:dom";
import type { Document } from "nts:dom";

export function main(document: Document): void {
  const greeting = document.createElement("p");
  greeting.textContent = "Hello";
  const body = document.body;
  if (body !== null) body.appendChild(greeting);
  setTimeout(() => { greeting.textContent = "Hello again"; }, 1000);
}
```

`main` runs once the page has loaded (DOMContentLoaded). From then on, Blink
calls the closures it registered: listeners, handlers, frame, idle and
timer callbacks, and observers (mutation, resize, intersection). `unload()`
runs when the document ends in a renderer that goes on (reload, navigation); closing the window may end the process without it, as
with page script's `unload`. Keep the app's state in what `main` creates.
Module-level state is not per document yet, and the build refuses it
(contracts/compiler-requests.md, 10). [`examples/todo`](examples/todo) is
TodoMVC, the same app the TodoMVC benchmark measures.

```sh
node tooling/chromium/app.ts build runtime/chromium/examples/todo [--backend c|llvm]
node tooling/chromium/app.ts run   runtime/chromium/examples/todo
node tooling/chromium/app.ts check runtime/chromium/examples/todo --expect '#app .todo-list'
```

`build` compiles the app, archives it with the host by Chromium's toolchain,
stages it, and builds `nts_app`. `run` opens the page from the app's own
origin, `nts-app://app/` (a secure context, served from the app's directory:
its stylesheets, images and `fetch()` of its own files). `check` runs the
lifecycle headless: start, render, reload, close.

### Common tasks

Page script's code mostly carries over as it is written; where `nts:dom`
spells something differently, [docs/lib-dom.md](docs/lib-dom.md) has the
table. In one place:

```ts
import { asHTMLCanvasElement, newResizeObserver, requestIdleCallback, setTimeout, window } from "nts:dom";
import type { Document, Event, IdleDeadline, ResizeObserver, ResizeObserverEntrySequence } from "nts:dom";

export function main(document: Document): void {
  const button = document.querySelector("#save")!;
  const canvas = asHTMLCanvasElement(document.querySelector("canvas")!)!;
  const ctx = canvas.getContext("2d")!;                 // the 2D context, as in page script
  ctx.fillStyle = "#336699";                            // a color; a gradient is _set_fillStyle_gradient(g)
  ctx.fillRect(0, 0, 40, 40);
  const storage = window().localStorage;                // `window` is window()
  button.addEventListener("click", (event: Event): void => {
    storage.setItem("saved", canvas.toDataURL());
  }, false, true);                                      // options as trailing arguments: capture, once, signal
  setTimeout(() => { button.textContent = "Save"; }, 500);
  requestIdleCallback((deadline: IdleDeadline): void => { /* deadline.timeRemaining() */ }, 1000);
  newResizeObserver((entries: ResizeObserverEntrySequence, observer: ResizeObserver): void => {
    for (let i = 0; i < entries.length; i += 1) { /* entries.item(i)!.contentRect */ }
  }).observe(canvas);
  const shadow = document.createElement("div").attachShadow("open");   // the mode, not { mode }
}
```

What differs from page script, in short:
- `new X(...)` is `newX(...)`, and narrowing (`instanceof`) is `asX(node)`.
- Options dictionaries are object literals of their boolean and number
  members only.
- A sequence (`addedNodes`, `getAnimations()`) is read with `length` and
  `item(i)`.
- An IDL enum is a literal union: `"open" | "closed"`.
- What does not exist yet (`fetch`, `history.pushState`'s state, promises
  from DOM calls) is in [contracts/workarounds.md](contracts/workarounds.md).

## Layout

| Directory | What it is |
|---|---|
| `dom/` | The surface a renderer program compiles against: `types/` (module `nts:dom`, generated from Blink's IDL, plus the hand-written rest) and `abi/` (the C headers under it). `nts:dom-testing` is what tests and benchmarks ask of the adapter, never an application. |
| `adapter/` | The Blink side of that ABI, staged into `//third_party/blink/renderer/nts`: the bridge (entries, roots, listeners, frames, jobs) and `dom_idl.cc`, generated by [`tooling/chromium/bindgen`](../../tooling/chromium/bindgen/generate.py) from Blink's own IDL with Blink's own binding generator. |
| `host/` | The program host every renderer client is built on (`host.c`: the environment, the entry each callback makes, Blink's microtasks, idle-time cycle collection) and the app runtime on it (`app.c`, `app_observer.cc`, `app_main.cc`: the `nts_app` shell). |
| `embedder/` | The test shell, staged into `//nts`: `nts_shell`'s renderer observer and `probe.c`, the fixtures' client of the host. `embedder/program/` is the one program it links -- its export list, build config, and `check.ts`, which builds both backends and checks that archive outside Chromium. |
| `examples/` | Apps: `todo/` is TodoMVC; `paint/` draws on Blink's 2D canvas with pointer events. |
| `tests/` | What the smoke runs: the boundary and DOM witnesses, the differential vectors (run compiled and, types stripped, as page script), and their `pages/`. |
| `benchmarks/` | `workloads/` (the compiled TypeScript each benchmark runs), `harness/` (C++ controls in the renderer), `pages/` (each workload's page, `X`, and page script's, `X-v8`), `standalone/` (rows over a minimal DOM, without Chromium). |
| `contracts/` | Compiler contract reductions, one directory each, and [what this lane has asked of the compiler](contracts/compiler-requests.md). |
| `docs/` | [architecture](docs/architecture.md), [costs](docs/costs.md) (measurements), [bring-up](docs/bringup.md), [DOM and microtasks](docs/dom-and-microtasks.md), and the superseded [handoff](docs/handoff.md). |

## Working on it

```sh
# Regenerate the DOM bindings after changing the allowlist or the generator.
python3 tooling/chromium/bindgen/generate.py

# Build both backends and check the archive outside Chromium.
NTS_BIN=<compiler> node runtime/chromium/embedder/program/check.ts
node runtime/chromium/benchmarks/standalone/check.ts

# Stage into the Chromium checkout and generate its build, then build.
node tooling/chromium/probe.ts c --profile perf
node tooling/chromium/chromium.ts build --profile perf

# Smoke: the DOM witness natively and through V8, then compare the two.
node tooling/chromium/smoke.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/native-dom-c-smoke c dom
node tooling/chromium/smoke.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/native-dom-oracle-smoke v8 dom
node tooling/chromium/compare.ts

# Benchmarks against page script on an unmodified content_shell.
node tooling/chromium/benchmark.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/rows-c c --workload rows
```

`benchmark.ts` takes `--workload binding|rows|kernels|todo`, and
`--trace` / `--profile-renderer` for diagnostics whose timings are not
results. Compiler and common-runtime changes belong to their owners: a gap
found here is reduced to a fixture and recorded in
[contracts/compiler-requests.md](contracts/compiler-requests.md).
