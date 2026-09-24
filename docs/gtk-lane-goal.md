# The GTK lane's goal

Written 2026-09-23 by the GTK lane session. It works beside MainClaude, whose
lane is language features and test262. The user decided the three things below.

## The goal

**A TypeScript program builds a real GTK4 application with an idiomatic API.**
The target is GJS-shaped:

```ts
const button = new Gtk.Button({ label: "Click" });
button.connect("clicked", () => count++);
```

- Closures may capture.
- A GObject's lifetime is tied to the TypeScript value.
- `class MyWidget extends Gtk.Widget` comes later.

The C-level binding layer is scaffolding for that, not the product.

- **Backends:** C first, then LLVM before each milestone closes. JVM does not apply.
- **Shared files:** this lane may edit compiler and runtime code, and announces each edit to a shared file to MainClaude *before* making it.

## Where it stands: M0, measured

`examples/interop/gtk-hello` (`cd4af93a`) is an `app.linux` executable with
gtk4 through pkg-config.

- **What it does:** `activate` builds a window holding a button, clicks it twice through the signal system, and quits.
- **Main arm:** prints `clicks=2 status=0`.
- **Control arm:** with the handler unconnected, prints `clicks=0`. `build.sh` fails if the two agree.
- **Environment:** runs under `xvfb-run` with `GSK_RENDERER=cairo` and `G_DEBUG=fatal-criticals`, and prints `SKIP` without gtk4 or `xvfb-run`.

### The chain, in the order the compiler reported it

| # | Blocker | State |
|---|---|---|
| 1 | A native pointer in a module-scope variable: `NTS1001 a module-scope variable of a native pointer, which a global has no storage for`. The build **exits 0** with the program missing. | Worked around: the body lives in `main()`. |
| 2 | `console.log` has no definition without the node modules, and `c:*` has no stdio. | Worked around: `hello_report` in the shim. |
| 3 | A `Struct` field read is `number & { __c_of?: c_int }`, not `c_int` (TS2345 at a `c_int` parameter). | Worked around: `as c_int`. |
| 4 | Binding generation read the package header without the pkg-config claim's `--cflags`: `'gtk/gtk.h' file not found`. | **Fixed** in `cd4af93a`. |
| 5 | The witness compiled the same header the same way, and called it "does not match the headers". | **Fixed** in `cd4af93a`. |

**What the shim still stands in for** (`native/hello.h`). Each function is one missing capability, and the step that removes it deletes it:

- **Strings:** `gtk_application_new("dev.nts.GtkHello", …)` and signal names.
- **Handle casts:** `GTK_WINDOW(w)` and `G_APPLICATION(app)`. One `Opaque` tag cannot become another, and nothing models GObject's hierarchy.
- **`g_signal_connect`:** a macro over `g_signal_connect_data`, whose `GCallback` is `void (*)(void)`.
- **`g_signal_emit_by_name`:** variadic, and takes a string.
- **Handler state:** a heap `Struct` passed as `user_data`. A capturing closure would replace it.

**What worked first time, and was not assumed to:**

- TS `function`s handed to C as `activate` and `clicked` handlers, and retained by GObject past the call that registered them.
- `malloc`ed context, and Struct writes from inside a handler.
- `g_application_run` driving the whole program from inside `main()`.
- Linking against gtk4 through `dependencies: { "linux-gnu": { from: "pkg-config" } }`.

**Not yet exercised: the event loop.** `g_application_run` blocks inside module evaluation, so a timer, a promise continuation, or anything posted to libuv during it would not run until it returns. The program uses none of these, which is why it works.

## M1, the minimum surface: where it stands

Each item is its own commit and fixture, announced to MainClaude with its
falsifier first, C then LLVM.

1. **Strings across the boundary: landed.** (`1be75f5e` runtime, `85cfd136` lowering, `961a2e84` gtk-hello.)
   - **Surface:** a `c:` parameter typed plain `string` is `const char *`, borrowed UTF-8 for the call. No brand, so the intersection wall never comes up.
   - **Example:** `examples/interop/native-string` checks the bytes C receives against node's TextEncoder. U+0000 stops at the boundary.
   - **Leak arm:** under valgrind, loss is flat from 1k to 20k calls, and a compiler without the release loses one block per call.
   - **Cost:** 15-16 ns per string call against 1.5 ns for an int; this is what a borrowed fast path has to beat.
   - Returned strings and `string | null` are still to do.
2. **Handle hierarchy: landed, upcasts only.** (`6b02cd21`.)
   - **Surface:** `Class<Tag, Parent>` in `c:types`. It is a tuple chain, so TypeScript's own assignability allows upcasts and refuses downcasts and sibling casts. The compiler holds the same chain on `Pointee::Opaque(Handle)`.
   - **Tests:** `widget as GtkButton` is refused in lowering (`a_class_downcast_by_assertion_is_refused`). The upcast runs on C and LLVM.
   - **Downcast:** a checked downcast is not built; `GTK_WINDOW(w)` stays in the shim. It will be designed with the Apple lane, which needs `isKindOfClass:`.
3. **Capturing closures into C: landed.** (`09ae016f` runtime, `580e25bb` lowering and backends.)
   - **Surface:** `Closure<F>` is retained and released by C's destroy notify. `ScopedClosure<F>` is lent for one call.
   - **Tests:** `examples/interop/native-closure` covers captures read back, two contexts that must not cross, a closure outliving its registering frame, an arrow taking fewer parameters than C passes, and a handle in the callback. Under reference counting, 50 subscribe/unsubscribe cycles leave `nts_live_count` exactly equal; the control without the notify grows by 50 or more. A throw inside still stops at the boundary.
   - **gtk-hello:** connects both signals with capturing arrows.
4. **The GLib loop: landed.** (`9055d56b`.)
   - **Design:** libuv stays the host, and a `GSource` on the default context drives it (`nts_uv_host_backend_fd` / `_timeout` / `_pump`, and `nts_glib_host.{c,h}`). The Apple lane writes a CFRunLoop adapter over the same three calls.
   - **Microtasks:** a callback returning to the loop at `depth` 0 is a checkpoint (`nts_checkpoint_after_callbacks`, set once in main.c before module evaluation). A handler entered synchronously from a task is not, so the task still runs to completion.
   - **Selection:** by link, for any program whose libs include `-lglib-2.0`.
   - **Tests:** `examples/interop/gtk-loop` has four arms: the exact order, a control with no drain, a control with the source detached, and idle CPU.
   - **Defect found:** `uv_backend_timeout` answers 0 for a loop with nothing alive. The source spun at 100% and starved GLib's idle sources until that was mapped to -1.
   - **The unembedded row** is an assertion in `native-callback`: no foreign loop means no checkpoint at a callback's return.
5. **Blocker 1** is still standing: a module-scope native pointer.

**M1 against its definition of done.** The program uses strings, upcasts, capturing arrows and a working loop, all on the C backend. The LLVM half of each compiler feature is checked by the C-and-LLVM tests in `compiler/codegen/llvm/tests/native.rs`, because `nts build` cannot produce an LLVM program yet. The shim is *not* down to true macros: `g_signal_connect_data`, `g_object_unref` and variadic emit remain. Each of those needs `gpointer` parameters or an erased `GCallback`, and that is the first question of M2 rather than a gap in M1's features.

**What the shim still stands in for** (`gtk-hello/native/hello.h`):

- **`g_signal_connect_data` itself:** its instance is a `gpointer`, its handler is the erased `GCallback`, and its notify takes two arguments. The shim is one generic `hello_connect`.
- **The downcast** `GTK_WINDOW`.
- **Variadic `g_signal_emit_by_name`.**
- **`g_object_unref`**, which is both `gpointer` and ownership.
- **Stdio.**

The first and the `gpointer` half of the fourth are what M2's generator has to answer, with generated glue or with erased-callback support. That choice is made there.

**Four tables a new runtime helper owes a row to.** Main went red twice by missing them. The list is in `nts_runtime.h`'s helper block:

- the LLVM signatures;
- `ERASES_CLASS` in the C emitter;
- `runtime::READS_ONLY`;
- the JVM `REFUSED_FLOOR`.

## M2, bindings from GIR: where it stands

`nts bind-gir Gtk-4.0` binds GTK's closure of 13 namespaces, and `nts build`
does it on its own for any `c:Name-Version` import (into `types/gir`,
cached by a stamp over the GIR files read and the `nts` that read them).
`examples/interop/gtk-gir` is a GTK program with no hand-written GTK
declarations. Landed:

| Commit | What |
|---|---|
| `2fdd62ee` | The binder: parse, facts, map, check, emit, with struct tags and enum signedness read from the headers, and every declaration compiled against them before it is kept. |
| `a113bc39` | `unsafeDowncast` (one generated `asGtkBox` per class), `Const<H>`, `string \| null` parameters. |
| `35f374f7` | The runtime's UTF-8 decoder is WHATWG's (it read an overlong `/` as `/`), and ASCII is copied: 80 ns to 36 ns for a 62-byte path. |
| `892eba61` | Strings C returns, copied, and freed by `@ntsFree` (`g_free` for transfer-full). |

Measured on this machine's GTK 4.22:
**8782 functions bound**, 418 of them typed signal connects.

**Typed signals.** A signal has no C prototype, so the binder emits one typed
view of `g_signal_connect_data` per class and signal:

```ts
/** @ntsSymbol g_signal_connect_data */
export function gtk_button_connect_clicked(instance: Erased<GtkButton>, detailed_signal: "clicked",
  handler: ErasedClosure<(self: GtkButton) => void, (data: Ptr<unknown>, closure: GClosure) => void>,
  connect_flags: c_uint): c_ulong;
```

All 418 views compile against GObject's header in the binder's self-check.
The compiler reads the view with:

- `@ntsSymbol`: a TypeScript name bound to another C symbol.
- `Erased<H>`: a typed handle spelled `void *`.
- `ErasedClosure<F, N>`: a bridge typed `F`, handed over as `GCallback`, with
  the destroy function's C type `N` stated by the binding.
- A string literal parameter type (`"clicked"`), crossing as any `string`.

Checked by `a_typed_signal_view_calls_through_an_erased_callback_on_both_backends`
(C and LLVM, no-GC and reference counting). Two views of one symbol call
through a fake registry, and fifty connect/emit/release cycles leave the live
count unchanged. The control skips the notify and must leave at least 100 alive. `gtk-gir`
connects `activate` and `clicked` through the generated views and reads its
flags from the generated `const enum`s. What remains in its shim is
`g_signal_emit_by_name` (varargs), `g_application_run` (an array), and output.

**Out parameters, and `GError **`.** An out parameter is a slot on the
caller's stack that C writes during the call: `Ptr<c_int>` for `gint *`,
`Ptr<GtkWidget | null>` for `GtkWidget **`, `| null` where GIR lets the
caller skip it, and `@ntsNoEscape` on each, which is what lets the storage be
a `local`. A function that `throws` takes a trailing
`error: Ptr<GError | null> | null`, the same shape. This needed no compiler
change beyond `Ptr` not distributing over `| null` (`eeb3a33c`), and it
emits exactly the C a person writes: `GError *error[1]` on the stack, passed as
`GError **`. `gtk-gir` reads two dates and a key file through them, with the
error slot null on success and set on a missing key.

This is the C layer. Turning the slot into a thrown `Error`, and out
parameters into return values, is the idiomatic layer's job (M3), as
TypeScript over these declarations. Refusals that `GError` alone stood
between: 453, now bound.

**String arrays in.** A `string[]` crosses as C's NULL-terminated
`char **`, converted for the call into one allocation (table and bytes) and
freed after it: `CStrings<Q>`, `Q` being the header's spelling
(`char **`, `const char **`, `const char * const *`) and nothing else, so
there is one path in the compiler and the runtime. `Counted<A, L, side>` adds
the length C takes beside it -- after the array or, for `argc`/`argv`,
before -- which the compiler fills; a `null` array is `(NULL, 0)`. An empty
array is a table holding only the terminator, never NULL. Refused without
`@ntsNoEscape`, since the table is freed when the call returns. `gtk-gir`
runs through the generated `g_application_run(app, ["gir"])`; its shim is
down to the varargs `g_signal_emit_by_name` and output.

**String arrays out.** A function returning a `string[]` returns C's
NULL-terminated `char **`, whose every element is copied
(`nts_strings_from_cstrings`) before `@ntsFree` releases C's -- `g_strfreev`,
declared taking `char **`. Borrowed unless `@ntsFree` says otherwise, the
rule a returned `string` follows: `const char * const *` then, `char **`
owned, which is GLib's spelling for 267 of the 300 such results; the rest are
refused rather than declared in a spelling the header contradicts. A result
is a plain `string[]`, with no markers to follow it into the program's
variables. `gtk-gir` splits a string with `g_strsplit`.

**Bytes in.** A `Uint8Array` crosses as a pointer to its own bytes,
borrowed in place for the call -- `CBytes<Q>`, `Q` the header's pointee
(`const uint8_t`, `uint8_t` for a buffer C fills, `const char`,
`const void`, `void`) -- with its byte length in a `Counted` slot. No copy in
or out: what C writes is in the array when the call returns, a `subarray`
passes its own offset, and `null` is `(NULL, 0)`. It needed no runtime
helper; `nts_view_bytes` and `nts_view_byte_length` were already on every
table. `gtk-gir` hashes three bytes from the middle of a larger array with
`g_compute_checksum_for_data`, and gets SHA-256's `ba7816bf`.

That run also found the witness redeclaring `g_free`, which GLib 2.78
defines as a function-like macro too: `void g_free(void *);` expanded into a
syntax error. The witness and the binder's self-check now write the
declarator in parentheses, `void (g_free)(void *);`, which no macro expands.

Six functions GIR spells `void *` where the header says `const void *`
(`g_output_stream_write` among them) are refused by the self-check, with
clang's words: GIR is wrong about them, and the check is what says so.

**Async callbacks.** GIO's `GAsyncReadyCallback` is called once, after the
`_async` call returns, with no destroy function: `OnceClosure<F>`, whose
bridge gives the closure back after that one call. `gtk-gir` wraps
`g_file_query_info_async` / `_finish` in a Promise and `await`s it -- what M3
will generate -- and reads `G_FILE_TYPE_DIRECTORY` for `/`. Checked under
reference counting: fifty runs leave no closure alive, and with the release
removed they leave a hundred. (`.then` on a promise is refused by lowering
today -- "no method table here"; `await` works.)

Two binder fixes it needed:

- **An interface's parent.** GIR omits `GObject` as a prerequisite --
  `GFile`, `GListModel`, `GAsyncResult` list none, while
  `g_type_interface_prerequisites` answers `GObject` for each -- so a
  `GFile` did not upcast to `GObject` and `g_object_unref(file)` did not
  typecheck. The binder now asks the type system: one small program per
  namespace prints each interface's classed prerequisite. A namespace whose
  probe cannot build or run answers nothing, and its interfaces keep no
  parent.
- **The binding cache.** Its stamp named the `nts` that wrote it and checked
  only that that binary was unchanged, so a different `nts` -- a newer binder
  -- reused an older one's bindings. It is the running one that must match.

**Still refused, ranked by count:**

- 643: GIR marks the function not introspectable.
- 290: arrays -- arrays of handles and records, and buffers C fills and
  returns, are what is left.
- 300: out parameters the caller allocates (a struct the callee fills in).
- 153: `gpointer` results and `gconstpointer` parameters.
- 50: string out parameters.

The binder's `*.refused.txt` is the queue.

## M3, the idiomatic layer: where it stands

**Methods on handles.** Every GIR method is also a method of its class:

```ts
box.append(label);            // gtk_box_append(box, label)
window.present();             // gtk_window_present(window), via the chain
application.run(["gir"]);     // g_application_run, from GIO, on a GtkApplication
file.query_info_async(...);   // an interface's method, with a OnceClosure
```

No wrapper object and no dispatch: each is the C function its `@ntsSymbol`
names, and the call site compiles to that call with the receiver first. The
binding declares it on an `…OwnMethods` interface with `this: T` for the
instance, and a class's `…Methods` is its own intersected with its parent's --
intersected rather than extended, so a subclass method sharing a name with an
ancestor's is an overload and not a conflicting redeclaration. The compiler
reads `this: T` from the checker (`SignatureRecord::this_type`, fetched only
for signatures that declare one) and passes the receiver there, converted
along the chain.

Cost, measured on gtk-gir's pre-M3 program with both binaries: 2.37 s ->
2.66 s to build, the same 140 MB peak, `Gtk-4.0.d.ts` 513 KB -> 962 KB.

**Next in M3:**

- Errors thrown: a method whose C function reports through `GError **` throws
  an `Error` carrying the `GError`'s message instead of taking the slot.
- Async methods as Promises: `await file.query_info("standard::type")`,
  from the `_async`/`_finish` pair.
- Typed `connect`: `button.connect("clicked", handler)`.
- Construction and lifetime: `new Gtk.Button({ label })`, and a GObject
  unreffed when the TypeScript value is released.

## After M3

- **M4: a real application,** benchmarked against GJS: startup to first frame,
  RSS, signal dispatch.

## Rules this lane keeps

These are inherited from `native-lane-goal.md` and not repeated here: two arms per claim, one variable per arm, explicit-path commits, three states for a gate verdict. Three are specific to GTK:

- **`G_DEBUG=fatal-criticals` on every run.** A GTK critical is a line on stderr and the program continues, which is exactly the silently wrong answer the controls exist to catch.
- **The shim is a ledger.** A function in `native/*.h` that outlives the capability it stood in for is the first thing to look for in review.
- **A change to how calls lower is bracketed over `runtime/node`.** Every GTK
  example calls C, so a rule about the C boundary is tested there only in the
  direction that cannot hurt. `78d5eb8b` typed `object` as `void *` wherever
  a callee had no body, which also caught an interface method and an
  `@ntsAbi managed` runtime call: `async_hooks.emitInit` stopped compiling,
  and with it callers in fs, http, net and timers, while every check this lane
  ran stayed green. Build all node modules with the previous binary and the
  new one (`NTS_ADDON_OUT` apart) and diff the refusals.
