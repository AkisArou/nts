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
4. **A GLib event-loop host: next.** `NtsHost` on the default `GMainContext`, with libuv embedded as a `GSource` over `uv_backend_fd` and `uv_backend_timeout`, selected by `app.linux`.
   - **Shared with Apple:** the core (embed libuv in a foreign loop) is written here, and Apple adds a CFRunLoop adapter against the same interface.
   - **Open decision:** `docs/native-operations.md:643`, whether a bridge drains microtasks on return. It is decided with MainClaude and Apple before it lands.
   - **Falsifier:** a `Promise.then` and a `setTimeout` started inside a click handler both run before quit. On the libuv host they do not.
5. **Blocker 1** is still standing: a module-scope native pointer.

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

## After M1

- **M2: `nts bind-gir`.** Reads GIR XML, which carries what headers cannot: transfer, nullability, closure and destroy pairing, the class hierarchy, and signals.
- **M3: the idiomatic layer.** Managed GObject wrappers, `new Gtk.Button({ … })`, typed `connect`, and Promises for `GAsyncReadyCallback`.
- **M4: a real application,** benchmarked against GJS: startup to first frame, RSS, signal dispatch.

## Rules this lane keeps

These are inherited from `native-lane-goal.md` and not repeated here: two arms per claim, one variable per arm, explicit-path commits, three states for a gate verdict. Two are specific to GTK:

- **`G_DEBUG=fatal-criticals` on every run.** A GTK critical is a line on stderr and the program continues, which is exactly the silently wrong answer the controls exist to catch.
- **The shim is a ledger.** A function in `native/*.h` that outlives the capability it stood in for is the first thing to look for in review.
