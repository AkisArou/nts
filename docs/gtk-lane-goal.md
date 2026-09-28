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
does it on its own for any `c:Name-Version` import. The bindings are
platform packages in the machine's store, not files of the project (see
"GTK as platform packages" below).
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

### Aliases, and bytes out of C

GIR's `<alias>` elements are now the types they name. `GLib.Quark` is a
`guint32`, and the same goes for `Pid`, `DateYear` and HarfBuzz's
`codepoint_t`, `bool_t`, `tag_t` and the rest, each spelled in C as the
parameter spells it, for the self-check to compile against the typedef.
`time_t` and `guintptr` joined the scalar table. In gtk-gir's binding set the
refusals went 2054 -> 1855, and "a type this binder does not know" 415 -> 80.
The rest are `cairo`, which no `.gir` on this machine describes, and a few
structs. The gir sweep over the eight core namespaces swept 73 more
functions, with 0 type errors and 0 refused.

**Bytes C hands back.** `bytes.get_data()` and `file.load_contents()` answer
a `Uint8Array`, as GJS's do. A result or out slot of `guint8`/`gchar` bytes,
whose length is another out slot, maps to `Shape::Bytes` (with
`Shape::Length`). The raw declaration keeps C's own spelling (`ConstPtr<void>`,
`Ptr<Ptr<c_char>>`) for the witness, and the values form makes the slots,
copies with `bytesFrom`, and frees with `g_free` where the transfer is full.
It meets the constraints agreed with MainClaude without a compiler role:

- the transfer is data: `g_free` only where GIR says full;
- the copy is `nts_view_from_bytes`, so the view outlives what it was read
  from;
- a failing call throws before the wrapper reads anything (its error slot is
  left out), and one with no error slot leaves the zeroed slots alone: NULL
  and 0, an empty array.

It does not return a values form's omitted outs: `load_contents()` answers
the contents alone, since `etag_out` is left at its default. A throwing
function's `gboolean` result is left out too, as GJS leaves it out: it only
says whether the call failed, which the thrown error already says. So the
answer is not `[ok, contents]`. 15 more functions bind (1855 -> 1840). The
gir sweep swept 11 more, with 0 type errors and 0 refused. Witness:
gtk-gir's `bytes 2:104,105 <?xml`, plain and `--rc`. `held()` returns a
`GBytes`' copy after the `GBytes` is gone, and a file's contents are copied
and C's buffer freed.

**Promise forms through values forms.** An `_async` method whose `_finish`
answers through out slots had no Promise form. Its Promise now settles with
what the `_finish`'s values form returns, where that form takes only the
instance and the `GAsyncResult`: `await file.load_contents_async(null)` is
the contents, as a `Uint8Array`. That is 122 of 134 async methods in
Gtk-4.0's closure, up from 121. Witness: gtk-gir's `awaited <?xml true`.

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

### Arrays of objects, lent in place

`store.splice(0, 0, entries)` is how GJS fills a store: one change
announced, where 5000 `append`s re-run every sort and filter model above
the store 5000 times (12.8% of the journal's cycles). `splice` takes
`gpointer *additions` and a count, and was refused "as an array", as were
`adw_navigation_view_replace`, `g_application_open` and five others.

- **The binder** maps an in array whose element is a class or an
  interface to `Counted<CHandles<H, Q>, …>` over the program's `readonly
  H[]`. `Q` is `"void"` where C spells it `gpointer *`, and `"element"`
  for `H **`. It is marked `@ntsNoEscape`, as `CStrings` is. The array
  needs a length and a transfer GIR *states* as none. A missing
  `transfer-ownership` reads as none everywhere else, and a borrow read
  into an array C keeps would be wrong in the direction nothing reports.
  The three transfer-full ones (`gdk_content_provider_new_union`, two
  expression constructors) stay refused.
- **No copy.** An array of handles is `managed<[native<_T>]>`, whose
  element block already is C's array of pointers. The loan is that block
  (`nts_array_handles`, NULL for `null`), and the array is given back after
  the call (`nts_array_unlend`, empty), as a view is for `CBytes`.
- **Any array of handles crosses unconverted.** A `GtkLabel[]` passed
  where `readonly GObject[]` is declared is the same block, and the array
  coercion would otherwise refuse it as another element width. `readonly`
  makes that sound, since nothing writes a `GObject` into the label array
  through it. The exception is that parameter only, and `Role::Handles`
  refuses an array whose elements are not native handles.
- **A missing element ends the process, naming its index.** The runtime
  makes no holes in an array of handles; it refuses to grow one by its
  length. So only a `null` the type system was talked out of (`null!`)
  can reach C, and C would read it as an object.
- **Cleared:** 8 of the 345 array refusals across the journal's closure.
  An override of a virtual function taking one (`GApplicationClass.open`)
  is refused ("entry point and compiled function disagree about arity"),
  not miscompiled: that direction converts a C array into a program one,
  which nothing does yet.

Witness: gtk-list's `spliced 3 2 b listed`. Three labels are spliced in a
temporary array, then an empty array removes the first; the task store is
filled by one `splice` of its `Task[]`. `listed` is a `GdkFileList` made
from two files, an array C spells `GFile **` rather than `gpointer *`: the
loan is returned as `void *`, which C converts to either, and a `void *const
*` did not compile there. It runs on C and LLVM, plain and
`--rc`. Each arm also runs with a `null!` at index 1 and must end with
"nothing at index 1". The `--rc` C build under AddressSanitizer is clean
on both paths, and `tooling/memory` and gtk-cycles are green.

**The give-back is not load-bearing today.** With `nts_array_unlend`
removed, ASan still reports nothing, because a temporary array is released
at the end of its statement, after the call. It guards against a release
moved to the last use, which is what made `nts_view_unlend` necessary for
views.

### Arrays of objects a handler is given

`app.connect("open", (app, files, hint) => ...)` is how every GJS
application that opens files (`HANDLES_OPEN`) takes them. C passes
`GFile **files, gint n_files`, and the signal was refused "as an array".

- **The binder** types the handler's parameter as it types a function's
  (`Counted<CHandles<GFile, "void">, …>`) and drops the length from the
  handler's parameters: it rides in the array. GIR spells a signal's array
  `gpointer`, the value the signal marshals; the handler is passed its
  address, a `gpointer *`.
- **One walker decides the arity.** `native::callback_slots` reads a
  callback's TypeScript signature once and answers both the bridge's C
  signature and what the bridge converts (`Bridging`): boxed records, and
  arrays with the C index of their length. Both backends map a C argument
  to the compiled function's parameter through `Bridging::parameter` and
  nowhere else, because two places deciding "how many parameters does this
  entry take" is how a callback becomes invalid HIR rather than a refusal.
  A boxed record inside a rest tuple was at the wrong index before; it is
  read by the same walk now.
- **The bridge** makes one array of the program's
  (`nts_array_from_handles`), each element counted through its family as
  `slice` counts one, so C may free its array when the handler returns.
  Under `--rc` the array is given back after the call, as a boxed copy is.
  A NULL element, or a NULL array said to have elements, ends the process,
  naming the platform as the source.
- **The type** is the array: a `CHandles` intersection is represented as its
  value, as `Property<T>` is its `T`, since the markers are optional and
  never exist.

Witness: `examples/interop/gtk-open`. The program opens two files itself
through `app.open([a, b], "hint")`, which lends the array out, and the
handler gets `open 2 a.txt,b.txt hint`. It stores the array, which is read
after the handler returns (`kept a.txt,b.txt`). That runs on C and LLVM,
plain and `--rc`. The `--rc` C build under AddressSanitizer is clean;
`tooling/memory` and gtk-cycles are green. With the per-element count
removed, the `--rc` arms die reading the kept array, so the count is
load-bearing.

This also found that an element-typed loan (`GFile **`, where `splice` is
`gpointer *`) did not compile in C; see "Arrays of objects, lent in place".

### A handler's out parameters: refused, not bound wrong

GIR gives a signal's parameters no C type, so the binder spells one from the
type's name, and an out or inout parameter came out without its `*`.
`GtkSpinButton::input`'s handler was declared taking `new_value: double`
where C passes a `gdouble *`. On x86-64 the pointer arrives in an integer
register and the bridge read a floating-point one. `GtkEditable::insert-text`
handed the handler `position` as the pointer's bits, and
`GtkOverlay::get-child-position` copied its caller-allocated rectangle, so
what the handler wrote never reached GTK. React's generator reading GIR
found it.

A signal with any parameter that is not `in` is now refused (4 across the
closure: those three and `AdwSpinRow::input`). GJS has such a handler return
its out values, which is the form to build. gtk-widgets' build asserts the
three are refused, and on the binder before, it fails naming `input`.

### GTK as platform packages

The bindings used to be generated into each project's `types/gir`, with a
stamp over the GIR files read. They are now packages in the machine's store
(`tooling/surfaces`), shared by every project there, as Apple's frameworks
are.

- **The binder.** `gir_surface::GirPlatform` implements
  `nts_surfaces::Binder`:
  - its identity is the GTK version, the architecture and the roots;
  - its version is a hash of the binder's own source (`GENERATOR`, kept
    whole by `every_generator_file_is_hashed`);
  - its inputs are the GIR files of the closure, found by reading only
    their `<include>` lines;
  - it generates one package per namespace, `@nts/gir-gtk-4.0` and so on,
    each still declaring `module "c:Gtk-4.0"`, so programs' imports did not
    change, plus `@nts/platform-gtk` naming them all.
- **Roots are what the program imports**, minus any another root's closure
  already binds. The store key follows the roots, so a GTK program and a
  libadwaita one are two entries. Binding libadwaita beside a plain GTK
  program would make its witness ask for `adwaita.h`.
- **`nts build`** installs them when the checker cannot find a `c:` module
  this machine has GIR for (`gir_surface::GirBindings`), links them into the
  project's `node_modules/@nts`, and opens the program through
  `tsconfig.gir.json`: the project's config, extended with the packages'
  files (`nts_surfaces::wrapper`).
  - **That file sits beside the project's own config.** TypeScript reads
    `${configDir}` as the directory of the config it opened, and react-gtk
    binds its renderer fork as `${configDir}/src/ReactFiberConfig.ts`. A
    wrapper under `.nts/` sent the reconciler to no host config: nothing
    imported the program's, so it was published as an entry, and its
    abstract classes tripped NTS2006.
- **`the_gir_packages_typecheck`** generates the Gtk and Adw closures and
  asserts two things: no type is declared by two packages, and all 30
  sources typecheck without `// @ts-nocheck`.
  - The packages carry their surface there. Without it, the frontend
    treats each declaration file under `node_modules` as a library and
    checks only the values files; a control injecting an undefined name
    then passed.
  - The first run found GObject's GIR re-declaring GLib's `IOCondition`.
    `enum_owner` now gives an enum to the namespace a re-declaring one
    includes.

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

**Construct-only properties.** `new GThemedIcon({ name })`, as GJS writes
it: a construct-only property has no setter, so it is given when the object
is made or never. A class made by its `GType` offers its own in its
`…Props`, and its `@ntsConstruct` tag lists every one a construction of it
can give, its ancestors' in its namespace included
(`GThemedIcon_construct g_themed_icon_get_type with name
use_default_fallbacks`). Where a literal writes one, the lowering builds
the object with them through three functions the binding declares for the
class:

- `GThemedIcon_builder(type)` begins one, `nts_gobject_with_builder_new` in
  `nts_gobject.c`;
- `GThemedIcon_with_name(builder, value)` gives each property the literal
  writes of those, through a thunk each backend defines as it defines a
  by-name setter (`nts_gobject_with_{kind}__{name}`, C's varargs promoted),
  and the builder collects the value as the property's own type, as
  `g_object_set` collects one (`G_VALUE_COLLECT_INIT`, copied);
- `GThemedIcon_build(builder)` makes it with `g_object_new_with_properties`,
  owned or floating as the class's `…_construct` view is.

The literal's other properties are then set as for any construction. A
props object passed through (`super(props)`) that could give one is refused
by name: it gives only what is present, and a build gives unconditionally.
Which callees are by-name thunks is one predicate, `is_by_name_thunk`, that
the lowering and LLVM both ask. Left out, and counted: a property whose type
has no mapping as a value (`GThemedIcon`'s `names`, a `GStrv`), and an
ancestor's in another namespace, which would be mapped against this one's
names. Witness: gtk-gir's `themed 6 document-open-recent`, the name and its
five fallbacks on all four arms, as GJS makes it. The corpus's Notification
passes; the store test pins the tag and the three functions.

**Constructors return their class.** `gtk_box_new(…)` is a `GtkBox`: GIR
declares a constructor inside its class and gives it C's return type, and the
binding writes `Declared<GtkBox, GtkWidget>` (244 constructors) -- the program
has the class, the prototype and the witness keep `GtkWidget *`. GIR's word is
trusted, as gtk-rs trusts it. A handle known only as a widget is narrowed
with `instanceof GtkBox`, as GJS writes it. The generated `asGtkBox` casts
went with the move to platform packages.

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

An interface requiring another is one too: `GtkSelectionModel` requires
`GListModel`, so `column_view.model.get_n_items()` and a selection model
passed where a list model is taken typecheck. The interface's own tag rides
in a marker's *key*, `__c_interface_GtkSelectionModel?: true`, which the
schema reads. It was the value of one key, `__c_interface?: Tag`, and two
interfaces gave that key two literals, so the sub-interface was not
assignable (TS2684). `__c_implements` is what tells interfaces apart: an
`Editable` is not taken for a `Cell` that requires it. A callback answering
the class where C declared the interface (`GtkTreeListModel`'s
`create_func` making a `GListStore`) answers the same address on both
backends. LLVM's bridges ask `passes_as_is` for this, the closure's and
Objective-C's, arguments and answers alike.

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

### Signals a class declares

GJS's `Signals`, typed from one declaration:

```ts
class Tally extends GtkButton<{ incremented: [by: number]; renamed: [to: string, from: string] }> {
  bump(by: number): void { this.emit("incremented", by); }
}
tally.connect("incremented", (self, by) => { /* self: Tally, by: number */ });
```

- **Typing.** Each binding class's constructor is generic in the signals a
  subclass adds, `new <Sig extends SignalMap = {}>(props?): Signalled<X,
  Sig>`, which intersects `WithSignals<Sig>` (`c:types`) into the instance
  type. The intersection makes its `connect`/`emit` overloads beside the
  binding's own, so a name or argument the map does not declare is the
  checker's error, and a plain `new GtkButton()` reads as before. Probed
  first against the real binding shapes; a merged `interface` (TS2320) and a
  `this`-indexed map (deferred inside the class) were the two that failed.
- **Registration.** The map survives into the structural snapshot as the
  phantom `__c_signals`, read into `ForeignClass::signals`. Each backend adds
  them to the class's `GType` the moment it is registered
  (`nts_gobject_add_signal`: `g_signal_newv`, the generic marshaller). A
  parameter is a `number` (`G_TYPE_DOUBLE`), a `boolean`, a `string` or a
  GObject; anything else is refused by name. Only a class over a binding's
  declares signals: one over the program's own inherits its parent's.
- **emit** is a call of `nts_gobject_emit_{kinds}__{name}`, which each
  backend defines as `g_signal_emit` by id, looked up on the instance's type
  once per thunk and cached. No name is parsed per emit, and the program
  makes no variadic call.
- **A binding's own signal is emitted the same way**, `button.emit("clicked")`
  as GJS writes it.
  - The binder writes an `emit` view beside each signal's `connect`, but only
    for a signal that returns nothing: one with a result would need the
    location `g_signal_emit` writes it through.
  - Its thunk is named by its parameters' C types
    (`nts_gobject_emit_gUInt__direction_changed`), so two classes'
    same-named signals of different shapes are two thunks. Every pointer is
    `void *`, so one thunk prints one prototype.
  - The self-check skips the view, since no header declares the thunk.
  - A signal that answers a number or a boolean emits too, and `emit`
    returns the handlers' answer. The thunk passes a zeroed local as the
    last vararg, which `g_signal_emit` writes the result through, and
    returns it. Its name carries `R` and the result's C type
    (`...RInt`). `keys.emit("key-pressed", ...)` is whether a handler took
    the key. A signal answering a pointer has no `emit`: nothing here says
    who owns what comes back. Witness: gtk-widgets' `handled true false`.
  - This retired the C `emit` shims. gtk-subclass is now TypeScript only: it
    logs with `console.log`, and its `native/` is gone.
  - Witness: every `clicked` in gtk-subclass, and `direction 2`, an enum
    through `g_signal_emit` that the program's handler hears.
- **connect** is `nts_gobject_connect`, as for a binding's signal, with the
  instance typed `void *` at every call, as the C function takes it.
- **Strings in a handler.** A callback bridge takes a `string` parameter: C's
  lent `const char *`, copied in for the call (NULL as `null`) and released
  after. The binder now binds a GObject signal carrying `utf8`: in gtk-gir's
  binding set the "a callback taking or returning a string" refusals went
  57 -> 15 (`GSettings::changed`, `GActionGroup`'s, `GtkLabel::activate-link`,
  `GtkEntryBuffer::inserted-text` ...). The rest are non-signal callbacks
  whose typedefs the witness compares exactly, and ones returning a string.
- Witnesses: gtk-subclass's `tally` arm (`tally +2=2+3=5 a>b on kid`) and
  gtk-gir's `inserted 0:x:1`, C and LLVM, plain and `--rc`. Control: with the
  registration disabled the C product dies on GTK's critical; the previous
  binary does not typecheck `inserted-text` (TS2769).

### Properties a class declares

GJS's `Properties`, written as a field:

```ts
class Note extends GObject {
  title: Property<string> = "";
  done: Property<boolean> = false;
}
```

- `Property<T>` (`c:types`) is `T` with an optional brand, so the field is
  read and written as any other, and is represented as `T`. At registration
  each marked field is installed on the class's `GType` as ids 1..n, with
  `EXPLICIT_NOTIFY`. A `number` (`G_TYPE_DOUBLE`), a `boolean`, a `string` or
  a GObject.
- Every write of the field notifies (`notify::title`) through
  `nts_gobject_notify_{Class}_{i}`, which caches the property's spec. A
  plain field does not.
- `get_property`/`set_property` reach the field through compiled accessors
  (`{Class}#get_{name}`, `{Class}#set_{name}`). A write through
  `g_object_set` or `bind_property` is therefore the program's own write:
  counted the same, and notified once. The accessors are listed in
  `ForeignClass::entered()`, the functions a runtime calls with borrowed
  arguments. Without that, the setter was taken to consume the string it
  stores, and an rc run read it back freed.
- **Detailed signals.** bind-gir types a signal GIR marks detailed as
  `"notify"` or the template literal `notify::${string}`, so
  `connect("notify::label", ...)` typechecks. GLib parses the detail.
- **A widget without counting.** A never-free build takes the floating
  reference of every GObject a foreign call hands it (`nts_gobject_made`,
  inserted by the HIR pass `floating` in place of `rc::insert`). That covers
  `new`, a static constructor (`GtkLabel.new(...)`) and a direct
  `gtk_label_new()`. Otherwise the first container owned the widget, and
  finalized it on letting go while a name still held it (react-gtk's list).
  Under counting nothing is inserted: the first retain is `g_object_ref_sink`.
  Its call is one of the triggers that link `nts_gobject.c`; a program that
  made a widget and connected nothing did not link without that.
- Witnesses: gtk-subclass's `notes` arm (`notes title done weight title a b
  true 2.5`), gtk-gir's `relabeled 2`, gtk-values' `kept`. Each is C and
  LLVM, plain and `--rc`, and each has its failing control recorded in its
  commit.

### A class built from a template

GJS's `Template` and `InternalChildren`, as a class writes them:

```ts
class Panel extends GtkBox {
  static readonly template = `<interface><template class="Nts_Panel" parent="GtkBox">...`;
  declare readonly title: GtkLabel;   // the child with id "title"
}
```

- The template is the static field's literal type. The children are the
  class's own `declare`d GObject-handle fields, each named by its id.
- Registration takes two hooks (`class_setup`, `instance_setup`):
  `class_init` sets the template and binds each child, and `instance_init`
  makes the children, including for a class without fields. The GTK calls
  are in `nts_gtk.c`, linked only by a program that declares a template.
- `panel.title` is `gtk_widget_get_template_child` by id
  (`nts_gobject_child_{Class}_{i}`), borrowed from the template.
- The template's `class` names the registered type, `Nts_{Class}`, as GJS's
  default is `Gjs_{Class}`.
- A template's `<signal handler="onPressed">` is the class's method of that
  name. It is registered with `gtk_widget_class_bind_template_callback_full`
  through an entry point that takes the signal's arguments and then the
  instance (`nts_gobject_callback_{Class}_{i}`). A handler that is no method
  of the class is refused (NTS1001). Witness: gtk-subclass's `pressed 1 p`.
- Chains work. `Wide extends Panel` gets `Panel`'s children, and a child
  is read from the nearest class up the chain whose template names it.
  `Tall extends Card`, each with a template, builds both, the parent's
  first.
  - GLib runs every ancestor's `instance_init` with `instance->g_class` set
    to that ancestor's class. So `nts_gobject_instance_init` runs the
    template of the class whose init it is, and makes the fields once, at
    the fields' owner's init.
  - A subclass with a template of its own writes both as `template: string`,
    because a literal type would not extend the parent's. The compiler then
    reads the initialiser.
  - Witness: gtk-subclass's `wide from the template 5 pressed 1` and `tall
    head foot true`. Each half of the fix alone fails it with a critical.
- Before this, a `declare`d field compiled into a state field nothing set,
  and reading it failed GTK's assertion. Witness: gtk-subclass's `panel from
  the template true`.

**A template known only at run time, and `GTypeName`.** GJS's `Template`
takes XML, a `resource:///` URI or a `file:///` one, and Workbench's demos
pass a string the host makes (`Template: workbench.template`). A class
writes the same, with any string:

```ts
class Stamp extends GtkBox {
  static readonly GTypeName = "NtsStamp";            // the template's `class`
  static readonly template: string = stampTemplate;  // made when the module runs
  onHit(button: GtkButton): void { ... }             // `<signal handler="onHit">`
}
```

- `GTypeName` is the name the type registers under, as GJS's is, and must
  be a string literal (refused by name otherwise). Without one the name is
  `Nts_{Class}`. The HIR carries it (`ForeignClass::type_name`), so neither
  backend spells the prefix.
- A template whose initialiser is not a literal is read when GTK first sets
  the class up: `{Class}#template` answers the static's string, and
  `class_init` lends it to `nts_gtk_class_template_text`, releasing the
  reader's result where the program counts. Before this, such a class
  registered with no template and no diagnostic.
- `nts_gtk.c` tells GJS's three forms apart, for a literal too: `resource:///`
  is `set_template_from_resource`, `file:///` is the file's bytes, anything
  else is the XML.
- A template the compiler cannot read (one known at run time, or a URI) may
  name any method as a handler. So every method whose parameters and result
  all have C types gets a handler's entry point, bound by its name, and GTK
  resolves the template's names when it builds an instance, as it does for
  GJS. A method it cannot call (`twice(of: number[])`) stays a method. An
  unknown handler is GTK's error at that point, where for XML the compiler
  reads it is still refused when the program compiles.
- Witness: gtk-subclass's `stamp NtsStamp 2 4 filed from a file sourced from
  a resource`, on all four arms. build.sh compiles the resource with
  `glib-compile-resources` and names both files to the program.

### GJS's `gettext` module

A port keeps GJS's import line, `import { gettext as _ } from "gettext"`.
The module is TypeScript, `runtime/gtk/gettext.ts`, with GJS's exports and
what each is in GJS (`modules/script/_gettext.js`): GLib's `g_dgettext`
family with no domain for the program's own, a `domain(name)` binding the
three to one, and libc's `textdomain`, `bindtextdomain` (with the codeset
UTF-8, as GJS sets it) and `setlocale`, declared in `runtime/gtk/libintl.d.ts`.

- **How a program reaches it.** `runtime/gtk/tsconfig.json` maps the bare
  name to the source, and a GTK program extends it, as a React program
  extends `runtime/react/tsconfig.native.json`; every corpus port does.
  Not a `paths` entry the GIR wrapper adds: a config's `paths` replaces the
  one it extends, so a project with paths of its own would lose them.
- **Its three functions under libc's names** are compiled under names of
  their own (`export { setLocale as setlocale }`): a compiled function is
  its C symbol, and they call libc's.
- **A `char *` libc answers into its own storage** is declared `Ptr<c_char>`,
  as the header says, and read with `stringFrom`; a `string` result is
  `const char *` to the native witness unless the caller frees it.
- **Not lowered yet:** a default import's member (`import Gettext from
  "gettext"; Gettext.gettext(...)`), NTS1001 "`default`, a name from an
  enclosing scope". The default export is there and typechecks.
- `LocaleCategory` holds glibc's `LC_*` values, written out: the header's
  constants reach a binding only once the constants fold lands.
- Witness: `examples/interop/gtk-gettext` translates from a catalogue
  build.sh compiles (`Saluton pomo pomoj Malfermi Saluton Untranslated`) on
  all four arms, and with no catalogue bound answers each msgid, which is
  its control. Without the base config the program is TS2307. The corpus's
  About Dialog is ported with its import unchanged.

### Interfaces a class implements

```ts
class Words extends GObject<{}, GListModelImplementation> {
  vfunc_get_n_items(): CNumber<"uint"> { return 3; }
  vfunc_get_item_type(): c_size_t { return gtk_label_get_type(); }
  vfunc_get_item(position: CNumber<"uint">): Owned<Erased<GObject>> | null { ... }
}
const model: GListModel = new Words();
```

- The second type argument of a binding's constructor (`new <Sig, Impl>`),
  one `{Name}Implementation` or a union of them, is what the class
  implements. The binder emits one per GIR interface with a `GType`
  function. It carries the interface's `vfunc_` methods as optional ones,
  so C's default fills a slot the class leaves alone, and three markers:
  - `__c_iface`, the interface struct and `GType` function, which the
    compiler registers by;
  - `__c_tag`, which makes the instance convert to the interface;
  - `__c_methods`, the interface's own methods, so `words.get_n_items()`
    reads.
- `Signalled<T, Sig, Impl>` intersects all of it (`Implementing` in
  `c:types`). An override is then checked against the interface's signature.
  `instanceof` reads the constructor with `any` for `Impl`, which implements
  nothing.
- The lowering reads `__c_ifaces` into `ForeignClass.protocols`, the field
  Objective-C's adopted protocols use. A `vfunc_` whose binding's slot is in
  an implemented interface's struct overrides that slot. It fills that
  interface's table, not the class's, and `nts_gobject_add_interfaces`
  (`g_type_add_interface_static`) installs it right after the class is
  registered.
- A method that overrides nothing is refused, as a class's is.
- `get_item` is transfer full. The label a TypeScript method returns leaves
  with the one reference it was made with, balanced under `--rc`.
- Witness: gtk-subclass's `words 3-0+1 4 beta false`. The class calls
  `this.items_changed` and a handler on its `items-changed` hears it. The
  count, and a label made by our method, both come through Gio's own
  `g_list_model_get_*`, on C and LLVM, plain and `--rc`. gtk-list binds a
  `GtkListView` to a million-row `Range` that holds no rows.

### A handle where any value may go

`unknown`, an `unknown[]`, a `Map`'s key or value hold a GObject as the value
tag `NTS_TAG_HANDLE_GOBJECT` (8) with the `GObject *` as payload: tags 8-15 are
the handle block, one per object system (Objective-C 9, COM 10), and each family
registers its retain and release (`nts_handle_family_register`) from a
load-time constructor, so `nts_value_retain`/`_release` count it under `--rc`.
One source of truth for which type erases to which tag: `hir::tags::
erased_handle_tag`. Reading one back (`instanceof`, a narrowed `Map<K, GtkButton>`
read, `for...of`) is a checked `Unerase`: `nts_handle_check` accepts the family's
tag or an absence and aborts otherwise, naming a box as its own case.

- Built in steps: (i) the tag block and family registration; (ii-a) GObject and
  COM erased as their tag; (ii-b) Objective-C too, replacing the box every
  table used to hold -- `nts_objc_key_object` and the CF host read the tag.
  Only a promise still boxes a handle.
- **Release timing.** A counted foreign local keeps its block's end, because a
  platform may hold one without a count (an `assign` delegate). One whose every
  use is an `Erase` -- directly or through a `Convert` view, `new GtkButton()`
  being a `GtkWidget *` converted -- goes only where nts counts it, and is
  released at its last use (`rc::only_erased`), as ARC gives a temporary back
  at the end of its statement. `held_to_the_end` (own.rs) treats the erased
  slot as the holder for the same reason.
- Witness: `examples/interop/gtk-values`, C and LLVM, plain and `--rc`. Its
  `watch` arm alone passed while the release gap was open -- `stash()` returned
  before the delete -- and its `temporary` arm, a button made in `m.set`'s
  argument list, is the one that read `held alive` before the rule.

### Construct-only properties: the constructor the literal chooses

A construct-only property has no setter, so `new X({ ... })` sets it through
a C constructor that takes it. The binder used to pick one per class. It had
to take *every* construct-only property, so `new GSimpleAction({ name })`
failed to type-check: the only constructor that qualified was
`new_stateful(name, parameter_type, state)`.

- `@ntsConstruct` now lists each constructor whose parameters are all
  properties, fewest first: `g_simple_action_new(name, parameter_type?) |
  g_simple_action_new_stateful(name, parameter_type?, state)`.
- A property is required only where every constructor takes it and none
  accepts NULL. A nullable one is optional with no `| null`, and absent is
  the NULL passed, as for a setter's.
- The lowering calls, for a literal, the constructor whose required
  properties the literal writes and which takes the most of what it
  writes. `{ name }` gets `g_simple_action_new`, `{ name, state }` gets
  `new_stateful`. A props object passed through gets the first.
- A constructor that throws is never one of these.
- Across Gtk-4.0's closure, 17 classes changed. Most were constructible only
  through `g_object_new` with no way to set a construct-only property, so
  they made a broken object: `GSettings` with no schema, a `GdkPixbuf` with
  no size, `GPropertyAction`, `GtkIconPaintable`.
- Witness: gtk-actions, C and LLVM, plain and `--rc`. It has actions, a
  stateful action toggled through the application, a `GMenu`, an
  accelerator and a `GtkCssProvider`.

### A property read one way and written another; a method on `gpointer`

- **Accessor pairs.** A property whose getter answers `string | null`
  beside a setter taking `string` was `readonly`, because one type would let
  `null` be assigned. `stack.visible_child_name = "x"` did not type-check.
  It is now an accessor pair, `get x(): string | null; set x(value:
  string);` (TypeScript 5.1's unrelated accessor types), each side carrying
  both `@ntsGet` and `@ntsSet`. That covers 57 properties in Gtk-4.0's
  closure.
- **`Erased` receivers.** A method whose instance C takes as `gpointer`
  (`Erased<GObject>`) was bound only as a function: `g_object_bind_property`
  existed, `source.bind_property(...)` did not. It is now a method, as a
  signal's `connect` already was.
- Witness: gtk-widgets, C and LLVM, plain and `--rc`. It has a stack and
  switcher, a grid, a spin button bound to a label, and `notify::`
  handlers on a switch and a drop-down. The previous binder does not
  type-check it (TS2339 `bind_property`, TS2540 `visible_child_name`).

### A property with no setter or getter method: by name

`width-request`, `GtkWindow`'s `default-width` and the scrolled window's
scrollbar policies are writable properties with no setter method. So `new
GtkWindow({ default_width: 400 })` did not type-check, and neither did
`widget.width_request = 80`, both of which GJS writes.

- The binder gives such a property a `set_{name}` method. Its symbol is a
  thunk the backend defines per property,
  `nts_gobject_prop_{kind}__{name}`, as `g_object_set(object, "name",
  value, NULL)`.
- The kind says how the value crosses the varargs: `i` an `int` (a
  `gboolean` or enum too), `u`, `l`/`L` 64 bits, `d` (a `float` promoted),
  `p` a pointer.
- A readable property with no getter gets `get_{name}` over
  `nts_gobject_propget_`, `g_object_get` into a local of its own type.
  - Where the class already has `get_{name}` (or `set_{name}`) from an
    ancestor or an interface, the synthesised method is named
    `$ntsPropGet_{name}` (`$ntsPropSet_`) instead, so the property keeps
    an accessor and the method keeps its meaning. Before, the synthesised
    method shadowed it, 43 times across the GIR set. For a string list,
    `get_n_items()` was a `g_object_get` of `n-items` instead of
    `GListModel`'s method. `GtkShortcutsShortcut.get_direction()` read its
    `direction` property instead of the widget's text direction, as
    `GtkShortcutsGroup.get_height()` read `height`. GJS keeps the two
    apart. The prefix is not `__`, since TypeScript escapes a name that
    starts with two underscores.
  - A string comes back copied, and is freed once read (`@ntsFree g_free`).
  - A GObject comes back owned (`Owned<X>`).
  - A boxed copy is left unreadable, as "a read of a native property no
    @ntsGet names a method for".
- A property's `utf8` has no C type in GIR, or has `gchar*`, which as a
  parameter means a buffer the callee writes. So the thunks spell it
  `const gchar*` in and `gchar*` back, and it maps as a lent parameter's or
  an owned result's string does. That cleared 69 "`Gtk.utf8`, a type this
  binder does not know" refusals.
- Neither thunk has a header: the lowering clears `declared_at` and types
  the object `void *`, as for `connect`, and the self-check skips them.
- Reach: 353 properties written (every writable one with no setter) and
  452 read, across Gtk-4.0's closure.
- LLVM promotes varargs itself. Writing it found that the emit thunk passed
  a `float` unpromoted and widened `int8`/`int16` with `zext`; one helper
  (`promoted`) now does both, signed as the C type is.
- Witness: gtk-widgets' `request 140`, `icon edit-clear file null same
  true` (a string round-tripped, an unset one, an object read back as
  itself), and `width 300` from `default_width`,
  on C and LLVM, plain and `--rc`. The same line checks GTK 4's own drawing:
  `Canvas`'s `vfunc_snapshot` appends a colour node through `GtkSnapshot`
  (`drawn true`). And `inherited 3=3 1 2`: a string list's `get_n_items()`
  and `n_items`, and a shortcut made with `direction: RTL` whose
  `get_direction()` is still the widget's LTR. On the compiler before, it
  read `2 2`.

### A method whose instance C accepts as NULL

`g_cancellable_cancel(NULL)` is legal, so GIR marks the instance nullable,
and the binder made such a function a function only: `GCancellable` had no
`cancel()`, `is_cancelled()` or `reset()`, and nothing said so in the
refusals. A method's receiver is never NULL, so it is now a method with
`this` typed non-nullable. That added 110 methods in Gtk-4.0's closure,
mostly on `GskTransform`, `GMainContext` and `GCancellable`. Witness:
gtk-actions' `dialog rejected Operation was cancelled`. `await
dialog.choose(window, cancellable)` is rejected with GIO's error when a
timer calls `cancellable.cancel()`, on C and LLVM, plain and `--rc`.

### Drawing with cairo

```ts
area.set_draw_func((area, cr, width, height) => {
  cr.set_source_rgb(0.2, 0.4, 0.8);
  cr.arc(width / 2, height / 2, 20, 0, 2 * Math.PI);
  cr.fill();
});
const cr = cairo_t.create(cairo_surface_t.create_image(Format.ARGB32, 64, 32));
```

- **A cairo namespace of the binder's own.** This machine ships
  `cairo-1.0.typelib` but no `cairo-1.0.gir`, and upstream's has types and no
  methods anyway. So every `cairo.Context` API was refused: 18 in Gtk-4.0,
  `set_draw_func` among them.
- `tooling/cli/src/bind_gir/cairo-1.0.gir` is embedded, and preferred where
  a system ships one. It holds upstream's records with their
  `cairo-gobject` GTypes, all 24 enums (values read from `cairo.h` by the
  compiler), and the drawing API as methods: paths, sources, strokes and
  fills, clips, transforms, text, groups, image surfaces, patterns. GJS
  hand-writes the same.
- The self-check compiles every declaration against `cairo.h`: cairo 83
  bound, 0 refused, and Gtk-4.0's 18 cairo refusals are gone.
- A record's constructors are statics of its value, as a class's are:
  `cairo_t.create(surface)`.
- **A boxed record C lends a callback** is boxed by the bridge. Before, the
  bridge cast C's `cairo_t *` to the program's box, and the draw function
  crashed in `cairo_set_source_rgb`. The same was true of any callback or
  signal handler taking a boxed record.
  - `OpKind::NativeBridge` carries `boxed: Vec<BoxedParameter>`: the index,
    and the `GType` function `schema::boxed` reads, the derivation the
    result path uses too.
  - Both bridges copy the record into a box after `nts_callback_enter`
    (`nts_gobject_boxed_copy`; `cairo_reference` for a context).
  - Under reference counting the bridge owns that copy and releases it
    after the call. A store that keeps the box counted it.
  - Without counting nothing is released: nothing counted the store either,
    and a release there ran `cairo_destroy` under a program that kept the
    context. A kept context then read 0 references.
- Witness: gtk-cairo, C and LLVM, plain and `--rc`. It draws offscreen, and
  in a drawing area's draw function.
  - `counted 2`: GTK's reference and the bridge's copy.
  - `kept 1`: a context kept past its frame holds the one copy.
  - `frames true growth 0`: five more frames with the program's live objects
    counted before and after. A bridge that never released its box grows by
    one a frame; without counting, growth is positive by design.

### Sorting and filtering by TypeScript

A `GtkCustomSorter` compares two `gpointer`s (`GCompareDataFunc`). GIR types
that callback once for every use, so it cannot say that for a sorter they are
list items, which are always GObjects. `set_sort_func` was refused as "a
`gpointer`".

- `COMPARES_ITEMS` in the binder lists the functions whose compare callback
  receives items: the sorter's, and `GListStore`'s `sort`, `insert_sorted`
  and `find_with_equal_func_full`. For those, the callback's parameters are
  `Const<Erased<GObject>>`: GJS's overrides know the same thing.
- `Const<Erased<H>>` is now `const void *` to the compiler, which dropped the
  `Const` before. The witness compares the header's `gconstpointer`s.
- The LLVM callback bridge passes one pointer as another, as the C bridge's
  cast does.
- An entry that `shadows` another is bound under that other's name, as GJS
  binds it: `g_list_model_get_object` is `model.get_item(i)`.
  `get_item` itself is not introspectable.
- `x?.prop` on a handle is read through the property's getter. It was taken
  for a struct field and refused.
- Witness: gtk-list's `sorted apple,banana,fig,kiwi,pear filtered
  apple,banana`: a sort model, and a filter model whose closure's captured
  bound changes before `filter.changed`. gtk-list now runs on C and LLVM,
  plain and `--rc`, where it ran C under `--rc` only.

### libadwaita, and what a props type says

Adw-1 binds from GIR like any other namespace (12,342 functions), and
`examples/interop/adw-hello` is an `AdwApplication` with an
`AdwToolbarView`, an `AdwHeaderBar` and an `AdwStatusPage`. It passes plain
and `--rc`, on C and LLVM.

It typechecks because a **props type folds `| null` into absent**.
`AdwPreferencesPage` redeclares `name` as nullable, where `GtkWidget`'s is
not, and a subclass's props must extend its parent's (TS2430 otherwise). The
binder of one namespace cannot see another's types to reconcile the two. For
construction a nullable property is given or not, and absent is the NULL the
object starts from, so the props type says `name?: string`. Each folded
property carries `@ntsNullable` and the sentence naming what is lost: a props
object cannot clear a property to NULL, because it is for construction only.
The folded set can be counted, so undoing it is a sweep.

**`super(props)`, a props object passed through, is parked.** An optional
property's slot is erased whatever its type. Reading a handle back out of
one needs handles in `NtsValue`, which the C backend refuses (NTS2008). The
work toward that is in steps that each land on their own:

1. `NTS_TAG_IS_REFERENCE` became `NTS_TAG_IS_POINTER` and
   `NTS_TAG_IS_MANAGED`, with each of its 24 runtime uses decided on its own.
2. The **handle tag block**, 8..15: `NTS_TAG_HANDLE_GOBJECT` 8, `_OBJC` 9,
   `_COM` 10. The tag is the object system, so a tag and a family cannot
   disagree. The block is a pointer and never managed. A handle counts
   through what its family registered, from the family's support file's
   load-time constructor (`nts_gobject.c` registers
   `g_object_ref`/`g_object_unref`), and every way it can go wrong aborts
   in its own words (`runtime/c/tests/handles.c`). This step is inert:
   nothing produces a handle value yet. `NtsValue` did not change, and a
   named `family` field was set aside because it would have changed how
   System V passes every erased value on LLVM.
3. Next, `Erase` and `Unerase` of a handle in the lowering and in both
   native backends, with the JVM refusing by name, and `typeof` answering
   "object".

### Lifetimes nts does not keep, witnessed

`examples/interop/gtk-iter-lifetime` has two arms that fail under `--rc`, on
purpose, and its `build.sh` requires them to fail:

- a `GtkTextIter` read after its buffer's last use, which a release at that
  last use frees. Releasing foreign handles at block end is what closes it;
- an iterator returned out of the function that owns its buffer, which no
  release placement closes.

GTK's contract is that the caller keeps the buffer alive. Plain passes both.
Either `--rc` arm passing fails the script, so the fix that closes the first
changes its expectation in the same commit.

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

**A class constructed with its own properties**, GJS's `new Book({ title })`
for a class that registers `title`: the class declares its constructor in
the one line TypeScript needs where GJS infers it, `constructor(props:
Properties<Book, GObjectProps> = {}) { super(props); }` -- `Properties<T, Base>`
(`c:types`) is the base's props and `T`'s `Property<V>` fields, each
optional, as one object type. `super(props)`
passes the object through, each property set where it was given; a
binding's property through its `@ntsSet`, the class's own through its
state's field, which notifies. A plain field of the class is not a
property, and a construction does not set it.

Still refused, each by name:
a constructor parameter that declares a field; an override of
`vfunc_finalize` (the registration's gives the fields back); a direct call
of a `vfunc_` method outside chaining up; and a slot taking a record by
value.

**`instanceof` and `$gtype`: a model of the program's own objects.** GJS
writes a list model as `new Gio.ListStore({ item_type: Task.$gtype })` over a
`class Task extends GObject.Object`, and narrows what a factory binds.

- **`x instanceof C`** for a GObject class `C` is `x !== null &&
  g_type_check_instance_is_a(x, C's GType)` (`lower_gobject_instanceof`).
  This works for a binding's class and for one the program wrote, so a
  subclass answers as it does in GJS. Before this, `new Task({}) instanceof
  Task` was `false` with no diagnostic, a managed-class check on a C handle,
  and `instanceof GtkLabel` was refused.
- **The narrowing** it gives the checker is honoured: `x` becomes `C`'s handle
  after the test. An `as` stays refused, because it is unchecked.
- **`x instanceof GdkRGBA`** for a boxed record asks the value, not a
  class: `nts_gobject_is_boxed(x, gdk_rgba_get_type())` is true of a box whose
  free is GLib's and whose `GType` is the record's (`lower_boxed_instanceof`).
  So a `GtkTextIter` — a box too — is not a colour, and a plain object is
  neither. A value already typed as the record answers whether it is there.
  Before this, the test was refused, as "no class for" the record. gtk-values'
  `boxes` line asks it of a colour, a text iter, a plain object, a number and
  `null`; with the `GType` comparison removed, the iter reads as a colour.
  - Every boxed record's value declares `[Symbol.hasInstance](value:
    unknown): value is X`, and the lowering finds the record by that
    predicate. A record with no constructor (`PangoAttrList`,
    `PangoFontDescription`, `AdwSpringParams`) had a value holding only
    statics, which tsgo refuses on the right of `instanceof` (TS2359), and
    an opaque one had no value at all. The construct signature was the
    lowering's route before, and a record without one had none. gtk-values
    asks it of an attribute list (`attrs:0 3 weight bold`).
- **`C.$gtype`** is `C`'s `GType`. The binder declares it on every class
  value, and a program class inherits it as a static but answers its own
  `nts_gobject_type_C`.

gtk-list's second view is a `GListStore` of `Task` read back through
`instanceof`, and gtk-subclass asks `instanceof` of three levels, a binding's
class and `null`.

Two corpus ports check this against GJS on drawn widgets: the driver's
`draw` presents the window and runs the main loop until the view is laid
out, and `labels` reads what the factories bound.
- **Column View** registers `Book` with three properties and sorts its
  columns by `GtkPropertyExpression.new(Book.$gtype, null, "year")`, a
  subclass property read through GObject's own property system. `sort` then
  `labels` reads the rows in year order and in title order. The port sets
  the sort model's `sorter` after construction, since a props object has
  no `| null` and the view's sorter is `GtkSorter | null`.
- **List View with a Tree** keeps plain fields (a title, an array of
  children) on a `GObject` subclass and handle fields on a `GtkBox`
  subclass, and its `create_func` makes a `GListStore` of the subclass per
  expanded row.

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
- An extension for what only GObject declares in `class_init`: signals and
  properties, both built (below, "Signals a class declares" and "Properties
  a class declares").

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
| an interface's virtual function (`get_n_items` on a model the program writes) | 7.8-8.1 | 14.5-15.4 | 294-313 | 20x |
| startup to a mapped window (ms) | 73.1 | 69.7-77.8 | 73.3-78.7 | 1.0-1.1x |
| startup peak RSS (MB) | | 88-101 | 105-120 | 1.2x |
| notes app, 1000 notes, open to quit (ms) | | 102-123 | 116-186 | 1.1-1.5x |
| notes app peak RSS (MB) | | 101 | 118-119 | 1.2x |
| task list: make and sort 10000 (ms) | | 5.7-6.9 | 7.8-8.3 | 1.2-1.4x |
| task list: 15 queries typed (ms) | | 113-142 | 301-318 | 2.2-2.7x |
| journal: load 5000 entries (ms) | | 9 | 86 | 9.6x |
| journal: 20 searches (ms) | | 114 | 220 | 1.9x |
| journal: 10 sort toggles (ms) | | 46 | 604 | 13.1x |
| journal: 200 added and edited (ms) | | 37 | 50 | 1.4x |
| journal: 50 chart frames, draw time (ms) | | 23 | 390 | 17.0x |
| journal: save (ms) | | 4 | 13 | 3.2x |
| journal peak RSS (MB) | | 128 | 162 | 1.3x |

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

**The interface row** is the one where nts is well off the floor. Every
entry from GTK's loop leaves through `nts_callback_leave`, which runs a
checkpoint. The checkpoint is about 2.2 ns of the 7 even when it finds
nothing: removing it measured 12.3-12.8, interleaved under the lock at load
~4.5. The rest is `nts_callback_enter`'s owner check and the environment
reads. The `vfunc` row pays the same and still reads at the floor, because
GTK's own `measure` work hides it. The runtime is MainClaude's, and the
numbers are with them. Times from `with-lock.sh` at load 4-5, five
interleaved rounds for nts and C, three for GJS.

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

**The task list** (`tooling/gtk-bench/tasks`, and `gjs/tasks.js` line for
line) is the first row whose time is the program's own. Ten thousand tasks
are made and sorted with `tasks.sort(compare)`. Fifteen queries are then
typed into a search whose `GtkCustomFilter` is a TypeScript closure, called
once per task per query. `run.sh` checks the two logs are equal before
timing. Its rows were measured while other sessions loaded the machine, so
they are ratios more than times. GJS's sort is SpiderMonkey's own, while
nts's is the merge sort the lowering writes. In the nts profile the program
is 23% of cycles: `nts_map_get` is 7%, hashing each filter call's freshly
converted title; the cycle collector is about 4%; the rest is GTK re-laying
out the list.

Writing it found five compiler defects, all fixed:
- `sort(compare)` was refused;
- `xs.slice()` answered an empty array;
- a parallel copy's scratch was always `double`, so two arrays swapped in a
  `while` loop did not compile, and failed JVM verification;
- `null` had no type for a lent array;
- the program's own GObject classes could be neither `instanceof`-tested
  nor named by `$gtype`.

The task list is now written as GJS writes one: each task a `Task extends
GObject` in a `GListStore` made with `item_type: Task.$gtype`, and a filter
that narrows with `instanceof Task` and reads the task's own fields, where
it first held titles and looked each one up in a `Map`. The two nts builds
were timed interleaved at a load average of 38, and their ranges overlap
(118-282 ms against 186-337 for typing). No difference between them is
shown, and no number from that run is one to quote.

The task-list rows' upper ends are the `Task`-object version, from a
`run.sh` pass at load average 7 rising to 14. The micro rows of that pass
matched the table above, each within its range.

**The journal** (`examples/interop/gtk-journal`, and `gjs/journal.js` line
for line) is the first application that uses every surface at once. It is
a libadwaita window with:
- a sidebar `GtkListView` over a filter model and a sort model, whose
  filter and sorter are TypeScript closures;
- an `EntryView extends AdwBin` built from a template, whose fields are
  bound both ways to an `Entry extends GObject` of `Property` fields;
- a cairo chart whose counts are the program's own aggregation;
- actions, a menu and accelerators;
- Gio stream I/O.

A scripted workload drives it headless over 5000 seeded entries: load,
twenty searches, ten sort toggles, 200 additions each edited through the
bound title, fifty chart frames, a delete, then a save. It prints counts, the
sort's head, the chart's peak and the saved file's bytes, which must match
GJS's log before anything is timed, and one `ms` line per phase. The chart's
line is the time spent inside the draw function. The frames themselves are
paced by a 16 ms timer, so the phase's wall clock measured the pacing, about
800 ms on both sides.

Writing it found, in the order the compiler reported them:
- a class whose only thunks were property notifications had its `GType`
  undeclared. `registered` is now shared by both backends and counts those
  thunks;
- `new EntryView()` in another module made an `AdwBin`: `gobject_new`
  resolved the class without following the import;
- `await file.load_contents_async(null)` settled as `[gboolean,
  Uint8Array]`. The Promise form now settles through the values form, which
  drops a throwing function's `gboolean`;
- `JSON` and `TextEncoder` are unsupported in core (reported), so the file is
  tab-separated lines read with `read_line_utf8`;
- `g_list_store_splice` was refused as an array, so loading appended one
  entry at a time. It is now bound (`CHandles`, above), and the journal and
  its twin load with one `splice`: 17-34 ms against GJS's 168-232, from
  about 300 against 700 with 5000 `append`s, at a load average of 55;
- `xs.map(entryOf)` is refused where `xs.map((one) => entryOf(one))`
  lowers: a `map` callback must be an arrow written at the call (core).

**Its rows** (the table above) are the program's own `ms` lines, best of
five runs with nts and GJS interleaved under `with-lock.sh`, both logs
checked equal first. They come from one `run.sh` pass that started at a
load average of 4.3 and ended at 9.3 as other sessions started work. The
micro rows of the same pass matched their ranges above. The sort row is
GTK re-sorting through each side's compare closure, and the chart row is
the program's own aggregation over the store: those are the phases where
the program's code is the time, and GJS is 13-17x behind. Load and add
are mostly GTK's own work once loading is one `splice`.

**Where its time goes** (`perf record -e cycles:u`, the `--rc` C build):
- `g_list_store_append` was 12.8% inclusive: each append re-runs the sort
  and filter models. Loading is now one `splice`.
- GTK's EGL probe at startup (`dlopen` of the GL driver) is 11%, and GJS
  pays it too.
- The chart's `monthly` is 7.2% inclusive.
- The program's own code is 3.7% exclusive.

**Next in M4:** the reference counting cost in the filter's profile
(`nts_retain` and the cycle collector), checked against a plain build on a
quiet machine; and the `outs` row, whose gap to C is the tuple allocation,
which a caller that only destructures could avoid.

## Completeness: the Workbench corpus

"Complete" is measured against real GJS programs. The corpus is
Workbench's Library demos (`github.com/workbenchdev/demos`, CC0; Workbench
itself is GPL-3.0, and none of it is copied here). The ports are ours, in
`examples/gjs-corpus/<demo>`:
- `src/main.ts`, the demo's own code as GJS writes it, in the function the
  host calls;
- `main.ui`, the demo's Blueprint compiled with `blueprint-compiler`;
- `driver.txt`, one action a line (`click <id>`), since the demos are
  interactive;
- `upstream`, the original's directory.

`tooling/gjs-corpus/run.sh` runs each port on C and LLVM, plain and `--rc`,
and compares every arm's log with the original's under GJS. GJS runs through
`host.js`, which gives the demo the `workbench` global Workbench's own CLI
gives it and reads the same driver. A demo passes when all four arms match.
The originals come from a clone named by `NTS_WORKBENCH_DEMOS`; without one
the harness says it skipped.

The nts host (`examples/gjs-corpus/host/workbench.ts`) differs from the GJS
one in two ways, both core gaps:
- a port's demo is a function the host calls, because nts compiles no
  dynamic `import()`;
- the driver is a line format read with `read_line_utf8`, because `JSON`
  and `TextDecoder` are not compiled.

| | ported | pass on every arm |
|---|---:|---:|
| 2026-09-27 | 1 (Button) | 1 |
| 2026-09-27 | 7 | 1 (Button); the other six stop at one blocker, a handle narrowed by `instanceof` and captured by a closure |
| 2026-09-27 | 9 | 1 (Button); seven stop at the captured narrowed handle, Scale at `Object.entries` over a `Record<number, string>` |
| 2026-09-27 | 14 | 2 (Button, Button Row); ten stop at the captured narrowed handle, Scale at `Object.entries` over a table, Stack at a `let` of a handle with no initializer |
| 2026-09-27 | 16 | 2 on main; 13 with the captured-handle fix (verified, waiting on the compiler hold), and Spin Button's last blocker is already on main |
| 2026-09-27 | 19 | 3 on main (Button, Button Row, Popovers); 16 with the captured-handle fix. Left: Scale (`Object.entries` over a table), Stack (a `let` of a handle with no initializer), Spin Button (its enum lookup, fixed on main after the fix binary was built) |
| 2026-09-27 | 25 | 8 on main; 14 stop at the captured narrowed handle, Scale at `Object.entries` over a table, Stack at a `let` of a handle with no initializer, Context Menu at a record's fields (`new Gdk.Rectangle({ x, y })`, designed with the compiler lane) |
| 2026-09-28 | 29 | **25 on main**, with the captured-handle fix (bd58854b9). Left: Stack (a `let` of a handle with no initializer), Scale (`Object.entries` over a table), Context Menu (record fields, designed), Boxed Lists (`GObject.TYPE_STRING` and `Gtk.ClosureExpression`, binding gaps) |
| 2026-09-28 | 34 | **28**. Also left: Text Colors (a spread in call arguments, then an array stringified), Text View (destructuring a handle's property) |
| 2026-09-28 | 51 | **41**: Search, ported and stopped at `new RegExp(...)` (a regex, not lowered yet) |
| 2026-09-28 | 50 | **41**: Link Button, Breakpoints and Shortcuts Window, each on its first build |
| 2026-09-28 | 47 | **38**: About Dialog (GJS's `gettext` module, its import unchanged) and Notification (construct-only properties, `new Gio.ThemedIcon({ name })`) |
| 2026-09-28 | 46 | **36**: List View with Sections, a `GtkStringList` subclass implementing `GtkSectionModel`. Its override writes C's out parameters through pointers where GJS returns `[start, end]`: an idiom gap, named below |
| 2026-09-28 | 45 | **35**: Custom Widget, a class whose `Template` is `workbench.template` and whose `GTypeName` its template names, a handler GTK finds by name |
| 2026-09-28 | 44 | **34**: Column View (an interface requiring another, now assignable to it) and List View with a Tree (a callback answering the class where C declared the interface, on LLVM). Drop Down's third gap (its subclass's own properties) is cleared; its two binding gaps remain |
| 2026-09-28 | 42 | **32** on main f3f4ac28e. Left, each named: a fundamental GType (Boxed Lists, Drop Down, Accessibility), GIR constants (Accessibility), record fields (Context Menu), a construct-only property no constructor takes (Notification), `Object.entries` over a table (Scale), a `let` of a handle with no initializer (Stack, Carousel), a property written through a union of handles (Carousel), a spread in call arguments (Text Colors), destructuring a handle's property (Text View) |

### What the corpus found beyond its blockers

**`Gtk.ClosureExpression` needs a closure that answers C an owned value.**
Boxed Lists and Drop Down write `new Gtk.ClosureExpression(GObject.TYPE_STRING,
(item) => item.string, null)`. `gtk_closure_expression_new` takes a
`GClosure` (refused, "an array"); `gtk_cclosure_expression_new` takes a
`GCallback` with its user data and destroy function (refused, "a callback
whose context is not the next parameter"), which is the shape a signal
handler binds through. But its C signature is known only at run time, from
`value_type` and the params, and GLib's generic marshaller calls it through
libffi and takes ownership of what it returns: a string must come back as a
`g_malloc`ed copy, an object with a reference. So the binding needs a typed
class value (GJS's three-argument `new`, the callback typed by the program)
and a bridge that answers an owned value, which no callback does yet.

**An override's out parameters are pointers, where GJS returns them.** GJS
writes `vfunc_get_section(position) { return [start, end]; }`, and a port
writes `out_start[0] = start` through the `Ptr<CNumber<"uint">>` the binding
declares (List View with Sections; `Square`'s `vfunc_measure` in
gtk-subclass). A call already answers GJS's way, a tuple for its out
parameters. An override could too: the binder declares the tuple result,
and the entry point writes each element through its pointer where the
pointer is not NULL. Not built yet; it changes `Square`'s working override,
so it lands with that arm rewritten.

Ports that pass still surfaced binding and harness gaps, each fixed or
named:
- Fixed in the binding: a property whose setter GIR names only by an
  `org.gtk.Property.set` annotation (`GtkImage:file`, `:resource`); a
  member named by a reserved word (`buffer.delete`); a signal handler's
  `self`, now the receiver (`this`) as GJS hands it over, not the class
  declaring the signal.
- Fixed in the harness: GJS's multi-line `console.log` read whole,
  `workbench.resolve` relative to the demo's own directory, and the demo's
  UI shown in the host's window, as Workbench previews it -- which is what
  lets `app.` and `win.` actions resolve from its widgets (Toasts).
- Designed, waiting on the compiler lane: a record's fields
  (`new Gdk.Rectangle({ x, y })`, branch `gtk-record-fields`) and GIR's
  constants (`GLib.PRIORITY_DEFAULT`, branch `gtk-constants`; floating ones
  left out, since GIR writes them to six digits).
- Open: a fundamental `GType` (`GObject.TYPE_STRING`) needs a typed
  constant, since a GType is a branded `bigint`.
- Open, a representation: GLib's refcounted records (`GDateTime`, `GBytes`,
  `GRegex`, `GKeyFile`, `GMainLoop`...) bind as opaque handles a program
  unrefs by hand, since their `get_type` is declared by GObject's headers
  rather than GLib's; the shape they want is a counted foreign family, as
  `GObject` is. And a boxed record's own free (`rgba.free()`) is offered,
  which frees what the program's box frees again -- GIR marks free
  functions on six records in all of GLib, so refusing them needs a source
  of truth rather than a name.

## Completeness: the binding census

The second gauge is what the GIR binder refuses and a GJS program could
call. `tooling/gir-census/run.sh` binds libadwaita's closure (Gtk and
everything beneath it) and counts every refusal except those GIR marks not
introspectable and those on deprecated entries, which no GJS program calls
either. Its baseline, `tooling/gir-census/baseline.tsv`, is the census
itself, one refusal a line, so a fix's diff is the list of entries it
cleared. A fix that clears entries updates the baseline in the same commit
(`--update`).

| | GLib | HarfBuzz | Gtk | Gio | GObject | Pango | Gsk | Gdk | Graphene | GdkPixbuf | Adw | GModule | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-27 | 327 | 221 | 155 | 143 | 59 | 51 | 26 | 25 | 17 | 12 | 11 | 1 | 1048 |

By reason, the families that matter to programs: arrays 317, `gpointer`
146, caller-allocated outs 69, records by value 47, callback shapes about
60, string outs 14. The remaining large rows are facts the headers and the
GIR disagree on (101 declared by no header, 82 not a tagged struct, 62
header signatures that differ), which the binder refuses on purpose rather
than guessing. Work on them is ranked by what the corpus hits, not by
these counts.

Button is the calibration. Its control, a port whose log line differs by one
letter, reads `differs` on all four arms. Of the 116 demos, 104 have a
JavaScript original, and 111 have a Blueprint that compiles. The five that
do not need Shumate, GtkSourceView, WebKit or libspelling.

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
