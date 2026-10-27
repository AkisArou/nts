# Chromium

The electron-like target: TypeScript compiled to native code and linked into
Chromium's renderer, driving Blink's DOM directly through `nts:dom`, with V8
left in the page, fully enabled, for whatever page script there is. Linux
x86-64 only, an opt-in source build, and not gated. For anyone writing an app
for it. The design in depth, with its measurements, is kept beside the code,
starting at
[`runtime/chromium/README.md`](../../runtime/chromium/README.md) and
[the architecture](../../runtime/chromium/docs/architecture.md).

## An app

An app is a directory with an `index.html` that opts in with
`<meta name="nts-app">` and a `main.ts` exporting `main(document: Document)`
and, if it needs one, `unload()`:

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

- **Typed against the DOM.** An app is written against the stock
  `lib.dom.d.ts`, as page script is, or against `nts:dom` directly. The target
  `target.chromium()` is a Linux target that adds the DOM's declarations and
  its native half, binding lib.dom's names to the generated bindings
  ([how lib.dom maps](../../runtime/chromium/docs/lib-dom.md)).
- **Its life:** `main` runs at DOMContentLoaded of each main-frame document
  that opts in; from then on Blink calls the closures it was given (listeners,
  handlers, frame, idle and timer callbacks, observers); `unload` runs when the
  document ends in a renderer that goes on. Each document's program gets a
  fresh environment. Module-level state is process-wide in a compiled program
  and would outlive the document, so an app build refuses it
  ([compiler requests](../../runtime/chromium/contracts/compiler-requests.md),
  10).
- **Building:** `node tooling/chromium/app.ts build <app> [--backend c|llvm]`,
  then `run` or `check`. `build` links the program into `nts_app_shell`, a
  content embedder of its own, against the pinned Chromium source build
  (`third_party/chromium`); `run` serves the app from its own secure origin,
  `nts-app://app/`.

## Where the program runs

The program (C or LLVM backend, reference counting) runs on the renderer's
main thread inside Blink's event loop. There is no libuv, no second loop, no
second thread, and no IPC per DOM call; browser-side services stay behind
Chromium's own IPC. Every native callback (an event, a task, a microtask, an
idle period) is one **entry** into the program, which enters the main world's
V8 context and holds a microtask scope on the document's own queue, and nothing
per operation.

## The DOM: `nts:dom`

- **Generated from Blink's IDL** by Blink's own binding generator
  (`tooling/chromium/bindgen`), so conversions, overloads, `[CEReactions]` and
  which members raise are decided by the code that decides them for page
  script. The surface is shaped like GTK's: an interface is a handle with its
  methods, an attribute a property read and written through two functions.
- **Coverage:** the DOM and its events, the HTML elements, forms, ranges and
  the selection, stylesheets, shadow DOM, the window and its services, URL,
  fetch, storage, the clipboard, crypto's random values, the observers, timers
  and `queueMicrotask`, the 2D canvas, and promise results. What does not bind
  is listed with its reason in `tooling/chromium/bindgen/report.json`, and
  every workaround in
  [`contracts/workarounds.md`](../../runtime/chromium/contracts/workarounds.md).
- **Errors:** a member Blink marks as raising throws an `Error` whose message
  is "Name: message", the DOMException's name and Blink's text; it is not a
  `DOMException`.

## Three heaps

The program's heap (reference counting with its cycle collector), Oilpan's
(Blink's nodes and wrappables) and V8's (page script) coexist, and none
collects another.

- **A node is its own address**, a `HostClass` handle; identity is pointer
  equality. Oilpan scans the native stack conservatively at every collection
  that can run under a native call, so a node the program only passes along
  costs nothing.
- **A node the program keeps is rooted.** Where a handle leaves the stack (a
  field, an array, a capture, a module global, an `await`, a return to C) the
  compiler calls the binding's `nts_dom_retain`, and `nts_dom_release` where
  that reference dies. The program never calls either. This needs the
  reference-counting provider, and a handle can neither be erased nor settle a
  `Promise`: both are refused by name.
- **Cycles across heaps are not collected.** A node holding a listener whose
  closure keeps the node is a ring neither collector sees. Listeners are
  removed explicitly (`listener.remove()`), and the end of a document gives
  back every closure Blink still holds. Designed, not built: a joint
  collection, in which Oilpan marks first and the program's collector severs a
  listener whose target Oilpan found unreachable
  ([memory](../foundations/memory.md#cycles-through-foreign-objects)).

## Strings

Text crosses into Blink as a `StringView`: the program's own units at their
own width, exact, NUL and lone surrogates included, copied once by Blink. A
literal is copied once per document, and a name (a tag, an attribute, a
selector) becomes its `AtomicString` once. Blink's text comes back as a view
of its own string, valid until the next call, which the compiler copies once
into a string the program owns.

## Scheduling

- **Microtasks:** the program's jobs join the document agent's queue, so
  promise jobs, Blink's internal microtasks and the program's drain together,
  at the outermost entry's checkpoint.
- **Timers** follow HTML's timer steps, as `DOMTimer` does: the 4 ms clamp
  past nesting level 5, intervals of at least 1 ms, the same task queues.
- **The cycle collector** runs in idle periods, not at every checkpoint.
- No `node:*` module is available in the renderer.

## What has run where

Linux x86-64, against the pinned Chromium checkout, on both backends. Each
check runs one source compiled through these bindings and, with its types
stripped, as page script through V8's, and compares the two. None of it is
part of the gate.

## Open questions

- The app's shape (a separate app process with IPC, as Electron):
  [S-4](../open-questions.md#6-bindings-products-toolchains-dependencies).
- One DOM source for Chromium and browser Wasm, and cycles across heaps:
  [I-8, I-6](../open-questions.md#5-interop-and-hosts).
- The lib.dom overlay injected by the target, and Blink's errors as
  `DOMException`: [G6](../open-questions.md#2-builtins-and-globals).

## Decisions

- In a Chromium renderer the host's builtins are taken, starting with Intl and
  RegExp (decision 3), and `node:*` APIs are never provided there (decision
  8) ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- An exception escaping a callback on a UI target, Chromium included, is
  reported, and the loop keeps running
  ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
