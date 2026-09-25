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

- 655: GIR marks the function not introspectable.
- 324: arrays -- arrays of handles and records, and buffers C fills and
  returns, are what is left.
- 158: `gpointer` results and `gconstpointer` parameters.
- 68: out parameters the caller allocates that are not a boxed record with a
  complete struct (300 before boxed records; see below).
- 50: string out parameters.

(Counts are for the Gtk-4.0 closure; the 643 above was an older count.)

The binder's `*.refused.txt` is the queue.

**Every binding lowers, checked.** The binder's self-check compiles each
declaration against the headers, which proves the C side and not the other:
that the compiler lowers a call at the TypeScript types the binder wrote.
`tooling/gir-sweep/sweep.mjs` binds each namespace, writes an uncalled
forwarder per function, builds it, and reports what lowering refused --
lowering visits every function whether anything calls it or not. Across the
Gtk-4.0 closure: 7,731 swept, 331 skipped because a closure or lent array is
among their required parameters (counted, and printed), 75 refusals that are
the harness's own (a `gpointer` bound as `object` forwarded through a
managed parameter), and **0** that are the bindings'. The first run found
four -- `Owned<Erased<GObject>>` results -- and a binary from before their
fix still reports them.

### Boxed records

`GtkTextIter`, `GdkRGBA`, `PangoFontDescription`: a GIR record with a
`glib:get-type` is a *boxed type*, which `GLib` copies and frees by its
`GType`. The binder writes one as `Boxed<"_GtkTextIter", "gtk_text_iter_get_type", 80>`
(`runtime/native/libc.d.ts`), and the program holds it in a box of its own:
`NtsBoxed` (`runtime/c/nts_runtime.h`), a managed object of kind
`NTS_KIND_BOXED` holding the struct's pointer and the function that frees
it. The box's last release frees the struct, so the program never calls
`*_free`.

- **Results.** Transfer-full results go into the box as they are
  (`nts_gobject_boxed`). Transfer-none results are copied first
  (`nts_gobject_boxed_copy`, `g_boxed_copy`), because the pointer is the
  callee's and can go stale.
- **Construction.** `new GtkTextIter()` makes zeroed storage
  (`nts_gobject_boxed_new`, `g_malloc0` of the size the headers give), freed
  by `g_boxed_free` like any other box.
- **Out parameters the caller allocates.** `buffer.get_bounds(start, end)` is
  passed the boxes' structs. This is where most of the 300 caller-allocated
  refusals went: a boxed record whose struct the headers complete maps like
  that. An opaque one (`GBytes`) has no size, and nothing allocates it.
- **Arguments.** C is passed the struct's pointer, and the box is lent for
  the call.
- **Cost.** 48 bytes per box: the header, the pointer, the free function and
  its one word of data. The box holds no copy function: nothing copies a
  box, and sharing one is the program's own reference.
- **Checks.** A `_Static_assert` in every emitted program compares the HIR's
  layout of the box with `NtsBoxed`. `gtk-gir`'s `boxedRecords` arm runs
  plain and `--rc`, on C and on LLVM.

- **Values forms.** A caller-allocated out also gets GJS's shape:
  `const [start, end] = buffer.get_bounds()` makes each record with `new` and
  returns it (binder `Shape::Filled`). An inout does not, because its
  storage holds what C reads. This took the closure's values forms from 145
  to 358.

Still missing: under `--rc` an iterator can outlive its buffer's last
use. `GtkTextIter` points into the buffer without counting it, so releasing
the buffer at its last use frees the storage the iterator reads. Foreign
handles are to be released at block end instead, against the fixture
`examples/interop/gtk-iter-lifetime`.

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

**Errors thrown.** A function that reports failure through `GError **`
declares that parameter optional and `@ntsThrows error
nts_gerror_take_message`. Pass a slot and read the error yourself, as at the
C level; leave it out and the compiler supplies a zeroed one, and after the
call -- once everything lent is given back -- a reported error is thrown as an
`Error` carrying its message:

```ts
try {
  keys.get_integer("a", "absent");
} catch (e) {
  // Key file does not have key "absent" in group "a"
}
```

The compiler knows nothing of GLib: the converter the tag names takes the
error and answers a `malloc`'d message, and GLib's is four lines in the GLib
host (`nts_gerror_take_message`). Checked on C and LLVM under both providers
with a fake error API and its own converter.

**Out parameters returned.** Without its slots, a method whose out
parameters are all scalars returns them, as GJS does -- the function's own
result first, then each out value in order, and a lone value unwrapped:

```ts
const [width, height] = widget.get_size_request();
const [selected, start, end] = entry.get_selection_bounds();
const [year, month, day] = when.get_ymd();
```

The same mechanism as the Promise forms below: an overload declared before
the C method, bodied (`@ntsCall`) by a wrapper in the companion module that
takes the slots as `local`s, makes the call, and reads them back into a
tuple. An optional slot is passed too, since a caller asking for the values
wants every one, and an error slot is left out, so a failure throws. A string
or handle *slot* keeps the C form: what is read out of it has an ownership to
settle that a number does not. A handle *result* beside scalar outs is fine
(`gtk_column_view_sorter_get_nth_sort_column`, checked under `--rc` with
`fatal-criticals`). 125 wrappers across the Gtk-4.0 closure, 66 in Gtk itself.

Cost: 12 ns against C's 4.2 and GJS's 165. The difference from C is the
tuple, one `NtsArray` allocated per call, since it escapes the wrapper; a
compiler that scalar-replaced a small tuple returned from an inlined
function would close it, and the slots are still there for a hot loop.

**C strings and bytes read back.** `stringFrom(p)` and `bytesFrom(p, n)`
in `c:memory` copy a `char *` into a `string` and `n` bytes into a
`Uint8Array`, for what does not arrive as a function's result -- which is
copied already -- but out of an out parameter's slot or a struct's member:

```ts
const stripped = local<Ptr<c_char>>();
pango_parse_markup("<b>bold</b> x", -1, 0, null, stripped);
const text = stringFrom(stripped[0]);   // "bold x", the program's copy
g_free(stripped[0]);
```

UTF-8 as node decodes it (an ill-formed sequence is one U+FFFD), NULL is
`null` for a string and, with a length of 0, an empty array; a length with
no bytes behind it ends the process. `stringFrom` is the copy a string
result already had (`nts_string_from_cstring`); `bytesFrom` is one new
helper, `nts_view_from_bytes`. Checked on C and LLVM under both providers,
nothing leaked under reference counting. They are what string, handle and
byte-array out values (`const [ok, contents, etag] = file.load_contents()`)
build on.

**Async methods, awaited.** Without its callback, an `_async` method is its
Promise form:

```ts
const made = await directory.make_directory_async();
```

The binding declares it as an overload of the C method, told apart by arity,
and bodies it with a wrapper the companion module generates from the
`_async`/`_finish` pair: start, and in the one callback call `_finish` -- which
throws the `GError` it reports -- and resolve or reject. `@ntsCall` is what
lets a handle method have a TypeScript body: it names the program's function,
called with the receiver first.

Counted, since an absent overload fails nothing (`*.promises.txt`, and the
binder's summary line), of GTK 4.22's 134 async methods:

| before the handle slot | after | |
|---|---|---|
| 59 | 107 | a Promise form |
| 48 | 0 | none: `_finish` returns a handle |
| 15 | 15 | none: `_finish` is not bound |
| 8 | 8 | none: `_finish` takes more than the result |
| 4 | 4 | none: `_finish` returns a 64-bit integer |

**A handle, awaited.** `await file.query_info_async(…)` settles with a
`GFileInfo *`, which is not a value -- the collector may not read it and
reference counting may not retain it -- so a promise holds a C handle in a
slot of its own (`NtsPromise::pointer`), outside its value and in neither of
its descriptor's tables. Not a value tag: the tag space is full by
construction -- a non-reference tag must sit outside `STRING..=OBJECT` and
below `OBJECT`, which leaves only the three taken -- and a tag above `NULL`
would answer `typeof x === "object"`, which `2fa3d575` guards. The generic
readers refuse such a promise rather than read `undefined` from it. Checked
on C and LLVM under both providers with a handle held across a second
`await`.

The 4 returning a 64-bit integer need a `bigint` payload, a different
question; the 15 with no bound `_finish` are the next to look at.

**Signals, as GJS connects them.** A signal is a method of its class:

```ts
button.connect("clicked", (self) => { clicks++; });
button.connect_after("clicked", () => { … });   // G_CONNECT_AFTER
application.connect("activate", () => { … });   // GApplication's, on a GtkApplication
```

One overload per signal, typed by it: the handler's parameters are the
signal's, `self` first. Each is `g_signal_connect_data` with the flags left
out (`@ntsDefault connect_flags=0`, and `=1` for `connect_after`). They are
methods only; the 419 free `gtk_button_connect_clicked`-style functions are
gone. Checked in gtk-gir by `order=ab`: a `connect_after` handler connected
first still runs after a plain one, where both connected plainly read `ba`.

**What nobody sets, left out.** `@ntsDefault flags=0 cancellable=null` gives
an optional parameter of a foreign function the value the compiler passes
when the caller leaves it out: an integer for a C integer or boolean, checked
against its range, `null` for a pointer that admits it. The binder writes it
only where GLib itself names the "nothing" -- `0` for a bitfield's flags,
`G_PRIORITY_DEFAULT` for an `io_priority`, `null` for a `GCancellable *` --
and only for a run at the end of the parameter list: 1317 declarations. A
Promise form takes the same as its wrapper's constant default parameters,
which an `@ntsCall` method now fills itself (a default that is not a constant
is refused: it would run after every written argument).

```ts
const info = await file.query_info_async("standard::type");   // was (…, 0 as c_uint, PRIORITY_DEFAULT, null)
```

**Strings reach C without a copy.** A `string` argument that is ASCII is lent
as its own storage, which is NUL-terminated in place; anything else is
transcoded to UTF-8 as before. 10M calls of a 40-byte argument: 69 -> 7 ns
per call; a Latin-1 one, which still copies, unchanged.

**The self-check asks for a declaration.** Each function the binder keeps is
a `_Static_assert` that the headers declare it with the type the compiler
will spell, so a GIR function in no header GIR names -- 71 of them, `g_access`
in `glib/gstdio.h` -- is refused ("declared by none of the headers GIR
names") instead of bound and failing in some program's build. One clang run,
where it was a loop; Gtk's closure binds in 1.1-2.0 s.

**Declined:** replacing `nts_view_unlend`, the empty call that keeps a
`Uint8Array` alive across a C call under reference counting, with a HIR
keep-alive op. It would be a new op in four backends to save one call per
`CBytes` argument, and the call has the shape `nts_cstring_release` already
has for the same reason.

**Enums as they are.** `import { Orientation } from "c:Gtk-4.0"` and
`gtk_box_new(Orientation.VERTICAL, 4 as c_int)`: an enum parameter or result
is `CEnum<GtkOrientation, c_uint>` (in `c:types`), so a member passes without a
cast and another enum's member is TS2345. The enums are `const enum`s in the
`c:` module, folded to their constants at the use, each also named by its C
type, which is what signatures spell.

**Constructors return their class.** `gtk_box_new(…)` is a `GtkBox`: GIR
declares a constructor inside its class and gives it C's return type, and the
binding writes `Declared<GtkBox, GtkWidget>` (244 constructors) -- the program
has the class, the prototype and the witness keep `GtkWidget *`. GIR's word is
trusted, as gtk-rs trusts it; `asGtkBox` stays for a handle known only as a
widget.

**GObjects are counted.** Under the reference-counting provider a
`GObjectClass` handle (488 classes) is retained with `g_object_ref_sink` --
which also takes a new widget's floating reference -- and released with
`g_object_unref`, both through a NULL guard GLib's pair needs; a program
never calls either, and the binding refuses them. `Owned<T>` (759 results)
and `Consumed<T>` (44 parameters) carry GIR's `transfer-ownership="full"`.
A counted handle may be passed where C takes its `GTypeInstance`, and
liveness keeps it alive wherever that view is. A promise of one holds it in
a box whose field is the handle, released by the box's descriptor. Under the
no-GC provider nothing is freed, a GObject included.

gtk-gir runs under `--rc` with `G_DEBUG=fatal-criticals` to the same log,
except where it awaits a rejected promise: that reaches a use-after-free in
the core's `try`/`await`/`catch` path, reproduced in plain TypeScript and
predating this work, which MainClaude has. The example gains its `--rc` arm
when that lands.

**The loop.** A GIO operation started without an application's loop keeps
the program running until it calls back (`nts_closures_owed`), as pending
I/O keeps node's; and a handler that turns GLib's loop itself -- a modal
dialog, a menu -- runs no libuv task under it (gtk-loop's `nested` arm).

**Properties, as GJS writes them.** `label.label = "tick 3"` and
`label.label`: a binding declares the property beside the methods GIR names
for it (`@ntsGet get_label @ntsSet set_label`), and a read or an assignment is
the call to that method -- its strings, `@ntsFree`, `@ntsThrows` and counting
unchanged. 1170 in Gtk's closure; 379 read-only, where the getter answers what
the setter does not take (`button.label`: `string | null` against `string`).

**Booleans are booleans.** A `gboolean` parameter or result is `CBool<c_int>`
-- a TypeScript `boolean` that C sees as its `int` -- so `button.has_frame =
true` and `if (w.get_visible())`; a C answer of 2 is `true`, as C says. 3678
in Gtk's closure. A callback's stay `c_int` for now.

gtk-gir runs under `--rc` too, with `G_DEBUG=fatal-criticals`, to the same
log: the core's `try`/`await`/`catch` use-after-free was a promise reader
lending a reference the caller released, fixed by MainClaude in 8fb8e494.

**Construction, as GJS writes it.** `new GtkButton({ label: "press",
has_frame: false })` is the class's `new` taking nothing, then the setter of
each property the literal writes, in its order -- no object is built for the
literal (`@ntsConstruct gtk_button_new` on the construct signature of a value
named for the class, beside its `GtkButtonProps`). A class with no such `new`
is made by its `GType`, every property at its default, as GJS makes every
class: `new GtkLabel({ label })` is
`g_object_new_with_properties(gtk_label_get_type(), 0, NULL, NULL)` through a
view the binder declares per class (`@ntsConstruct GtkLabel_construct
gtk_label_get_type`) -- floating for a `GInitiallyUnowned`, `Owned`
otherwise. 241 constructible classes in Gtk's closure, 127 of them by type.
Passing the type exposed a core defect: every integer argument to a native
call went through a double on its way to C's parameter, 53 bits for a 64-bit
`GType`, since a foreign callee had no signature `specialize` consulted.

**Interfaces.** `entry.get_text()` and `entry.text`: a GObject interface is a
handle type, `GObjectInterface<"_GtkEditable", GtkWidget>` -- its
prerequisite's handle, spelled by its own tag in C, `GtkEditable *`, as the
header declares a parameter of one -- and a class says what it implements,
`GObjectClass<"_GtkEntry", GtkWidget, "_GtkEditable" | …>`, inheriting its
parent's. TypeScript's structural typing makes a `GtkEntry` assignable to a
`GtkEditable` and nothing that does not declare it; the binding merges each
interface's methods and properties into its implementers', as GJS does. 518
`implements` in Gtk.

What the checker vouches for is the *type's* claim, not the pointer's: a
handle that came through `as`, or a binding whose `<implements>` GIR got
wrong, converts all the same. For GObject a wrong one fails loudly -- every
interface function checks `G_IS_…` and `G_DEBUG=fatal-criticals` ends the
run -- which is why the compiler does not re-derive the relation; an
Objective-C protocol built on the same `__c_implements` would have no such
check behind it, and needs one.

**Next in M3:**

- Construct-only properties (`GtkApplication`'s are settable; `GSubprocess`'s
  `argv` is not): `GValue`s through `g_object_new_with_properties`' names
  and values.
- Cycles through a GObject (below).

### Cycles through a GObject: design

**The defect, measured.** Under `--rc`, `button.connect("clicked", () =>
button.set_label(…))` leaks the button. A probe counting finalizations with
`g_object_weak_ref` (real GTK, fatal-criticals): a plain unparented label is
finalized (1); one whose handler captures *another* object is too (1); one
whose handler captures itself is not (0); and neither is the same label
parented into a window that is then destroyed (0) -- GTK4 disposes a child
only at its last unref, and the handler's closure holds one.

The cycle is closure --(a foreign slot: `g_object_ref`)--> X --(the
`GClosure`'s lend of the closure)--> closure. Neither edge is one the
collector sees: a foreign slot is not a reference field, and a lend is a
count from outside.

**Not GJS's shape.** GJS gives each GObject one wrapper holding one toggle
reference, and the toggle says when that reference is the last. We hold one
reference per live TypeScript value (3 at construction: each SSA view
retains), so "the toggle is the last" is not the fact; and a wrapper is an
allocation and an indirection on every toolkit call, and a second
representation for foreign objects beside Objective-C's.

**The shape: a holder is a node of the trial deletion.**

1. *Registry.* Every connect view calls `nts_gobject_connect`
   (`runtime/c/nts_gobject.c`), which is `g_signal_connect_data` -- the same
   `g_cclosure_new` and `g_signal_connect_closure` -- keeping the `GClosure`.
   Each connection is recorded against its instance, keyed by that closure:
   the destroy notify receives only the lent closure, so one closure
   connected to two instances could not otherwise say which edge ended, and
   removing the wrong one leaves a phantom edge that can whiten a closure a
   live instance still holds. The instance's record is the node: it carries a
   header the collector walks, so the algorithm stays one algorithm. No tag,
   no lowering change, no runtime helper -- the registry is the family's.
2. *Edges.* During a collection only, an object's foreign slot pointing at a
   registered X is an edge to X's record, and X's record has an edge to each
   closure it holds. An X with no record holds nothing and is no node.
3. *Count.* A record's count is X's own `ref_count`, read the first time a
   collection reaches it (`nts_collection_epoch`), so a trace pays for the
   nodes it touches and not for every node there is; the family reads it
   (`nts_gobject.c`, so the runtime stays GLib-free). Trial deletion subtracts the edges from the candidate graph;
   what remains is held from elsewhere. A transient GTK reference (emission,
   layout) is a real reference, so it can only keep X black -- latency, never
   a collection of something alive. Measured: inside the label's own
   `notify` emission its `ref_count` is 6 against 3 outside, where the
   program's loads explain at most one. Floating references never reach
   here: the program's first retain is `g_object_ref_sink`, and the probe
   reads floating = 0 at every point; `g_object_is_floating` stays as a
   guard that states it.
4. *Cyclic.* A layout holding a counted GObject is cyclic, since the object
   can hold any closure lent to it. Measured: gtk-gir's candidates 10 -> 19;
   a 20M-iteration loop storing rows that hold labels, 1000 more candidates
   -- one per row, as buffering is once per object. What narrows it is
   dynamic: an object that holds no lent closure has no node, and a slot
   pointing at it is no edge.
5. *Revisit.* `window.destroy()` drops GTK's reference to the label on the
   GObject side, where no release of ours happens, so nothing becomes a root.
   At a checkpoint, a record whose `ref_count` fell since a collection last
   read it is a root. Reading every record at every checkpoint cost 146 us
   with ten thousand connected labels (1-2 us with none), and a checkpoint
   runs after every task; so a checkpoint reads a share of them, 64,
   round-robin -- 2 us at ten thousand -- and such a cycle is found within
   (records / 64) checkpoints rather than at the next.
6. *Collect, in an order that survives re-entrancy.* White records first
   mark their closures severed, so an unlend reaching one is a no-op; then
   their handlers are disconnected (`g_signal_handlers_disconnect_matched` on
   the closure's context) -- the destroy notifies run and do nothing; then the
   dead objects are freed as today, releasing their foreign slots, which is
   X's last unref. No signal is left to run TypeScript during it, and all of
   it runs under `collecting`.

7. *Edges by mode.* `nts_each_reference` takes the edges it wants:
   destruction asks for the ones an object owns, the collector's four walks
   for the traced ones. A node is traced and never released by the runtime.

A garbage object's own handlers do not run on the way out: they are garbage
with it and severed first, as GJS refuses to call JavaScript during a sweep.

**Measured** (`examples/interop/gtk-cycles`, real GTK, fatal-criticals):
a self-capturing label is finalized, and so is the same label parented into
a window that is then destroyed (both 0 before). A label whose emission holds
the only references outside its cycle survives a collection that looks at
it mid-emission -- the second handler still runs, and the candidate count
shows the collection did look, so the arm tests something -- and is
collected once the emission ends; with the emission's transient references
subtracted from the count, the second handler is severed instead. A chain
whose last holder is a garbage cycle goes with it, inside the sweep. On both
backends against real libgobject
(`a_cycle_through_a_gobject_is_collected_on_both_backends`), with no revisit
an instance the library let go of is never collected, and with the family not
registered no cycle is.

### Subclassing a GObject: built, step one

**Where it stands** (`examples/interop/gtk-subclass`, C and LLVM, plain and
`--rc`): `class Counter extends GtkButton` is a `GType` of its own,
`Nts_Counter`, registered the first time one is made. A `vfunc_clicked()`
method is the override GTK calls through `GtkButtonClass.clicked`, with
`this` the button and the class's other methods callable on it. A class over
the abstract `GtkWidget` answers `gtk_widget_measure` through
`vfunc_measure`, writing through the out slots GTK passes. `new Counter({
label })` makes one of the class's own type, then runs the setters.

How, and where it differs from the design below:

- **Each slot is an offset.** The binder asks clang for `offsetof` of every
  class struct member it declares a `vfunc_` for (`@ntsVfunc GtkButtonClass
  clicked 408`), and the witness asserts both the member's type and that
  offset. Registration (`nts_gobject_register` in `runtime/c/nts_gobject.c`)
  writes each entry point at its offset in `class_init`, so neither backend
  needs a class struct's type. `program.c` does not include GLib's headers,
  which is what forced this, and the LLVM backend needed it anyway.
- **Registration is lazy**, GObject's own `get_type` convention. There is no
  constructor before `main`, and so no `llvm.global_ctors` to share with the
  Objective-C and COM lanes.
- **The parent's `GType` comes from the value**, `@ntsGType` on a phantom
  `__c_gtype` member. The snapshot keeps a value with a construct signature as
  that signature, with its members dropped, so the member's declaration is
  where the tag survives.
- **Until now it was a silent miscompile.** Before this, `class Counter
  extends GtkButton` compiled and ran: `new` made a plain `GtkButton`, and
  `vfunc_clicked` was never called. A class over any handle that nothing
  registers (a subclass of such a subclass among them) is now refused, and
  so is its `new`.

**Fields** (`count = 0` on a class over `GtkButton`) live in an object of
the program's own that the instance holds, as an Objective-C subclass's do,
with the same maker contract. Registration grows the instance by one pointer
past the parent's; `instance_init` stores the fields' object there and
`finalize` gives it back, then chains to the parent's; and `this.count` or
`counter.count` is a field of the object `nts_gobject_state` lends. A
subclass's instance carries its parent's tag, so its fields are found by the
receiver's type, not by the handle's tag. Checked on both backends in both
modes, and under valgrind with no invalid access. A plain `GObject` subclass
made and dropped 100 times leaves one state behind at exit, which is the
candidate the cycle collector has not reached yet, not a leak per instance.

**Constructors**, GJS's shape: `constructor(name: string) { super({ label:
"hi " + name }); ... }` is `{Class}#new`, whose `super({ ... })` makes the
instance of the class's own `GType` with the literal's properties and binds
`this`; the body then runs with it (a field set, a handler connected that
captures `this`). It must open with `super(...)`, as Apple's must. An
instance GTK makes itself (a builder file) runs `instance_init`, so it has
its fields, but not the constructor, the same rule as a nib's.

Still refused, each by name: `super(props)` passing a props object through,
which needs a presence-checked setter per property rather than a literal's;
a constructor parameter that declares a field; an override of
`vfunc_finalize` (the registration's gives the fields back); a direct call
of a `vfunc_` method outside chaining up; and a slot taking a record by
value.

**A class over a class the program wrote**: `class C extends B`, `class B
extends A`, `class A extends GtkButton`.
- **Registration.** `gobject_parent` answers `nts_gobject_type_B` for `C`, so
  `B` is registered before `C` asks for it as a parent, including when the
  program only ever makes a `C`. Each backend registers such an ancestor
  (`registered`).
- **One state object per instance, in one slot.** The slot belongs to the
  first class of the chain that has fields (its `owner`). Only the owner
  installs `instance_init` and `finalize`, and both go through the owner.
  GObject calls every class's `instance_init` with the instance's class and
  inherits `finalize`, so a slot per class made the state twice. It also
  looped forever: a parent's `finalize` looked the class up from the object
  and found the child again. That loop is the control, and it still times
  out.
- **Prefix layout.** Each class's state is its parent's followed by its own
  fields. The state layout names the parent's as its `base`, so `verify`
  checks the prefix (`BrokenBase`) and `put_bases_first` keeps it. A parent's
  method reads its fields through its own layout. Controls: with the chain's
  fields built in reverse, the fixture still passes, because
  `put_bases_first` restores the order. With the reversal and no `base`,
  `A`'s method reads `C`'s field.

The fixture has three levels, each chaining up to the last, plus both
mirrors: a parent with fields under a child with none, and a parent with none
under a child with fields.

**Chaining up**: `super.vfunc_show()` in an override calls the parent class's
implementation, read from its class struct at the slot's offset when the
call is made (`nts_gobject_parent_slot`), through a thunk each backend
defines per slot used (`nts_gobject_chain_{Class}_{offset}`), typed as the
overridden declaration is. It does nothing where the parent leaves the slot
empty, which is GObject's convention. The fixture's control: `Shy`
counts in `vfunc_show` and chains up to GTK's, which is what makes a widget
visible (`shy 1 true`); without the call it reads `shy 1 false`.

A GTK caveat the fixture ran into: a widget with a layout manager is measured
by it, so overriding `vfunc_measure` on a `GtkButton` subclass changes
nothing. That is GTK's rule, and GJS's too. `Square`, over the bare
`GtkWidget`, has no layout manager. A
field initialiser that calls or reads anything is refused as Apple's is,
since it runs inside `instance_init`.

The design as reviewed:

```ts
class Counter extends GtkButton {
  count = 0;                                  // instance state
  static signals = { bumped: [c_int] };       // declared by the subclass
  constructor(props: GtkButtonProps) { super(props); }
  vfunc_clicked(): void {                     // overrides GtkButtonClass.clicked
    this.count++;
    this.emit("bumped", this.count);
  }
}
const button = new Counter({ label: "0" });   // a real GType, `COUNTER` in the inspector
```

GJS's spelling, where it has one: `vfunc_` names an override, and a class
is registered when it is declared. Everything below builds on the record the
Apple and Windows lanes share (`Program::foreign_classes`, 702cfa56), as a
third family beside `Objc` and `Com`.

**What the record carries for `Family::GObject`:**

- `name` (the GType name: the class name, as GJS does unless `GTypeName`
  says otherwise) and `superclass` (the parent's C type, from the binding).
- For each method, a dispatch key: a new arm, `GObjectVfunc { class_struct,
  field }`, beside `Selector` and the COM slot. `field` is the member of the
  parent's class struct (`GtkButtonClass.clicked`); `class_struct` is the
  class struct that declares it, which can be an ancestor's
  (`GtkWidgetClass.snapshot`). The binder already reads GIR's
  `<virtual-method>`s, so it emits which `vfunc_` names exist and their C
  signatures, and an unknown `vfunc_x` is a typecheck error, not a silent
  method.
- `state`: the maker of the instance's managed state, as ObjC has it
  (`nts_objc_state`, `{Class}#state`). For GObject it is made in
  `instance_init` and released in `finalize`, which chains up. The state
  object is a holder node for the cycle collector, so a closure a subclass
  keeps in a field is traced the way a connected handler already is.
- An extension for what only GObject declares in `class_init`: signals
  (`g_signal_new`, typed from a static `signals` table) and properties
  (`g_object_class_install_property`), later.

**What each backend emits for one class:**

- `{name}_get_type()`: `g_type_register_static_simple` once, with the
  class and instance sizes taken from the parent's `GTypeQuery` at run time
  (C knows the struct; nothing in TypeScript has to), plus room for the state
  pointer.
- `class_init`: each vfunc entry point written into its field, cast through
  the class struct's C type, which the C backend spells from the header; for
  LLVM the binder records the field's offset, checked by the witness
  compiling `offsetof`.
- The entry points themselves reuse `ObjcEntry`'s shape: C arguments in,
  `this` recovered from the instance, and a record result through an out
  pointer where the vfunc returns one.
- `new Counter(props)` constructs through the class's own GType, via the
  same `@ntsConstruct` path a bound class uses, with `{name}_get_type()` in
  place of the bound `get_type`.

**Order:** registration and `vfunc_` overrides with no state (C, then
LLVM); then instance state; then declared signals; then properties. Each
step gets a fixture whose control is a GTK behaviour visible only if the
override ran, like a `snapshot` that draws or a `clicked` that counts.

## M4: against GJS, and a real application

`tooling/gtk-bench/run.sh`: the same program in TypeScript (nts, `--rc`) and
in GJS, one process per case under xvfb, beside C calling GTK directly --
the floor, which says how much of a row is GTK's own work. GJS 1.88.1,
GTK 4.22; ns per operation, best of three in-process runs after one untimed.

| case | C | nts | GJS | GJS / nts |
|---|---:|---:|---:|---:|
| signal round trip (`set_value` -> `value-changed`) | 218-314 | 185-201 | 701-713 | 3.5-3.8x |
| property write + read (`label.label`) | 261-263 | 265-273 | 388-825 | 1.5-3.1x |
| construct (`new GtkLabel({ label })`) | 4811-4890 | 4814-4983 | 5742-5919 | 1.2x |
| inherited method (`get_visible()`) | 4.0 | 4.1-4.2 | 128-133 | 31x |
| out values (`const [w, h] = get_size_request()`) | 4.2 | 12.0 | 165 | 13.8x |
| a virtual function GTK calls (`measure` on a subclass) | 14.8-15.0 | 14.5-15.1 | 234-241 | 16x |
| startup to a mapped window (ms) | 73.1 | 69.7-77.8 | 73.3-78.7 | 1.0-1.1x |
| startup peak RSS (MB) | | 88-101 | 105-120 | 1.2x |
| notes app, 1000 notes, open to quit (ms) | | 102-123 | 116-186 | 1.1-1.5x |
| notes app peak RSS (MB) | | 101 | 118-119 | 1.2x |

Ranges are separate runs on a machine other sessions share, which is also
why a row's C can read above its nts: both are GTK's own work at the same
floor. The method row was 20.3 ns until an upcast borrowed its handle's
reference (`own::views_borrow`); `g_object_ref_sink`/`g_object_unref` around
every inherited call was 45-55 ns against GTK's 5-6. It then read *below*
the C floor, 4.1 against 7.3, because the C kept the widget and the count in
static globals, which C re-reads after every call; written with locals, as
nts holds them, C is 4.0. The notes application is
`examples/interop/gtk-notes` against `gjs/notes.js`, line for line. The
virtual-function row is `gtk_widget_measure` on a `GtkWidget` subclass
whose override answers constants (`class Square extends GtkWidget` in nts,
`GObject.registerClass` in GJS, `G_DEFINE_TYPE` in C), with `for_size`
cycling past GTK's size cache so every call reaches the override: nts's
entry point is a direct C function in the class struct, at the floor, where
GJS enters its engine for each call.

**Where the notes row's time goes** (`perf record -e cycles:u`, the `--rc`
build, 1000 seeded notes, 654 samples): the dynamic loader 36%, libgtk 18%,
GLib 10%, libc 9%, fontconfig 5.5%, and the rest in expat, the GL driver,
GObject, HarfBuzz and Pango. **nts's own code is 0.24%**, all of it
`nts_collect_cycles`. The row measures GTK starting, laying out and
rendering 1000 labels, which is the same work on both sides, so a few
milliseconds either way between runs is noise and not a finding. For nts to
be visible, a case has to spend its time in the program: the micro rows do,
and so would a larger app with real logic per row. The binary binds lazily,
where gjs is linked `BIND_NOW`, so the loader's share is GTK's dependency
closure and not symbol resolution the program asked for.

**Next in M4:** the application larger -- a `GtkListView` over a
`GListStore`, a file chooser -- and a profile of where its time goes beside
GJS's.

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
