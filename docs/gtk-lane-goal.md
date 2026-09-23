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

## Next: M1, the minimum surface

Each item is its own commit and fixture. Each is announced to MainClaude with
its falsifier first. C first, then LLVM.

1. **Strings across the boundary.** A borrowed C string that a TS `string` converts to for the duration of a call; a returned one is copied. Branded **nominally, not as an intersection**: MainClaude notes that an intersection has no representation (`lower.rs:10347`), which is also blocker 3's shape.
   - Falsifier: `α😀` round-trips, and a corrupted length arm fails.
2. **GObject handle hierarchy.** `Opaque` with a parent chain and implicit upcasts (`hir/native.rs:532`). Downcasts only through a check backed by `g_type_check_instance_is_a`.
   - Falsifier: a `GtkWidget` where a `GtkWindow` goes is refused by the checker, not by GTK at run time.
3. **Capturing closures into C.** A function-typed parameter paired with its `user_data` and `GDestroyNotify` parameters. The closure is retained when registered and released when notified.
   - Falsifiers: a captured `let` changes and TS reads the change back, and the reference-count floor is unchanged after `g_signal_handler_disconnect`.
   - Must go through `push_call`, per MainClaude, so the raise test from record 0343 covers any new call path.
4. **A GLib event-loop host.** `NtsHost` on the default `GMainContext`, with libuv embedded as a `GSource` over `uv_backend_fd` and `uv_backend_timeout`. Selected by `app.linux`.
   - Needs a decision on `docs/native-operations.md:643`: does a bridge drain microtasks on return?
   - Falsifier: a `Promise.then` and a `setTimeout` started inside a click handler both run before quit, and on the libuv host they do not.
5. **Blocker 1**, if nothing in MainClaude's lane gets there first. A native pointer is a word, and a module-scope word has somewhere to live.

**M1 is done when** `gtk-hello`'s shim holds only true macros, and the program uses a string, an upcast and a capturing arrow handler, on C and LLVM.

## After M1

- **M2: `nts bind-gir`.** Reads GIR XML, which carries what headers cannot: transfer, nullability, closure and destroy pairing, the class hierarchy, and signals.
- **M3: the idiomatic layer.** Managed GObject wrappers, `new Gtk.Button({ … })`, typed `connect`, and Promises for `GAsyncReadyCallback`.
- **M4: a real application,** benchmarked against GJS: startup to first frame, RSS, signal dispatch.

## Rules this lane keeps

These are inherited from `native-lane-goal.md` and not repeated here: two arms per claim, one variable per arm, explicit-path commits, three states for a gate verdict. Two are specific to GTK:

- **`G_DEBUG=fatal-criticals` on every run.** A GTK critical is a line on stderr and the program continues, which is exactly the silently wrong answer the controls exist to catch.
- **The shim is a ledger.** A function in `native/*.h` that outlives the capability it stood in for is the first thing to look for in review.
