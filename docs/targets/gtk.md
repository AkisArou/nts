# GTK

GTK 4 applications written in TypeScript and compiled to native code on
Linux, with an API shaped like GJS's: GIR's classes as TypeScript classes,
closures that capture, subclasses the program writes, and GObject lifetimes
tied to the TypeScript values. For anyone writing a GTK program for nts. It
builds on the [native target](native.md) and its C interop.

## A GTK program

```ts
import { Box, Label, Orientation, init } from "gi:gtk";
import * as Gio from "gi:gio";

init();                        // gtk_init
const box = new Box({ orientation: Orientation.VERTICAL, spacing: 6 });
const label = new Label({ label: "hi", useMarkup: true });
box.append(label);
const store = new Gio.ListStore({ itemType: Label.$gtype });
```

```ts
// nts.config.ts
import { app, defineConfig } from "@nts/config";

export default defineConfig({
  products: { hello: app.linux({ entry: "./src/main.ts" }) },
  gi: { gtk: "4.0" },          // optional: the newest installed GIR otherwise
});
```

The product is an ordinary Linux executable, on the C or LLVM backend. The
bindings name the pkg-config packages their headers and libraries come from
(`@ntsPackage`), so a program compiles and links against GTK without listing
it in `dependencies`. The project includes `runtime/native/libc.d.ts`, as every
native binding does.

## Two surfaces over one binding

| import | spelling | for |
|---|---|---|
| `gi:gtk`, `gi:gio`, `gi:glib`, `gi:gobject`, `gi:adw`, ... | GIR's names, members in camelCase, other namespaces qualified (`Gio.ListModel`) | programs |
| `c:Gtk-4.0`, `c:Gio-2.0`, ... | the C names (`GtkBox`, `gtk_box_append`) | bindings, and C-shaped code |

The `gi:` module is the `c:` binding renamed: one mapping, checked against the
headers once. A program may import a module by name or as a namespace.

**Where the bindings come from.** `nts build` generates them on this machine
from its GIR files and headers, the first time a program imports a namespace
the machine has GIR for, and keeps them in the type store (`~/.cache/nts/types`,
or `NTS_TYPES_ROOT`): one package per namespace (`@nts/gir-gtk-4.0`,
`@nts/gi-gtk`) and `@nts/platform-gtk` naming them, shared by every project and
generated again only when the GTK version, the roots or the generator changes.
They are linked into the project's `node_modules/@nts`. `girExtras` in
`nts.config.ts` adds what a namespace's GIR does not reach: headers, their
pkg-config packages, and macros. `nts bind-gir` runs the same generator by hand
([CLI](../reference/cli.md#nts-bind-gir)). Nothing GIR marks unintrospectable
is bound, and an entry the headers and GIR disagree about is refused, not
guessed.

## What a binding does

- **Methods** are the C functions they name (`@ntsSymbol`), called with the
  receiver first: `box.append(label)` is `gtk_box_append(box, label)`. There is
  no wrapper object and no dispatch.
- **Properties** are read and written through their accessors (`@ntsGet`,
  `@ntsSet`), or by name where GIR gives none. A constructor takes the
  properties as an object literal, construct-only ones included.
- **Signals:** `connect(name, handler)`, `connectAfter`, and `emit` for the
  signals a class declares. A handler may capture.
- **Errors:** a function that reports failure through `GError **` takes that
  parameter as optional (`@ntsThrows`). Left out, a reported error is thrown as
  an `Error` carrying the error's message.
- **Out parameters:** a method whose out parameters are scalars returns them,
  its own result first, as GJS does: `const [width, height] =
  widget.getSizeRequest()`.
- **Async functions:** a GIO operation taking a `GAsyncReadyCallback` has a
  form returning a `Promise` beside the callback form.
- **Interfaces and narrowing:** a class implements its GIR interfaces (a
  `GtkEntry` is a `GtkEditable`). A program narrows with `instanceof`, as GJS
  writes it, which asks the class's `GType`.
- Boxed records, list models with TypeScript sort and filter functions, and
  cairo drawing (`cairo_t` is a boxed record, so a `DrawingArea`'s draw
  function gets a usable context) are bound. GJS's `gettext` module is
  `runtime/gtk/gettext.ts`.

## Subclasses

```ts
import { Button } from "gi:gtk";
import { GObject, property, signal } from "gi:gobject";

class Book extends GObject<Book> {
  title = property("");
  readonly isbn = property<string>();     // required at construction
}

class Tally extends Button<Tally> {
  readonly incremented = signal<[by: number]>();
  count = 0;
  vfuncClicked(): void {
    this.count++;
    this.emit("incremented", this.count);
  }
}
```

- A class over a GObject class registers a `GType` of its own (`Nts_Tally`),
  the first time one is made. `new Book({ title, isbn })` constructs it with
  its properties; a constructor written by hand opens with `super({ ... })`.
- `vfuncX` (or `vfunc_x`) overrides the class struct's slot `x`; the binder
  records each slot's offset, and the witness checks it.
- Fields live in an object of the program's own that the instance holds,
  given back when GObject finalizes the instance.
- `property()` and `signal()` declare GObject properties and signals; the
  self-typed heritage clause (`extends GObject<Book>`) types the constructor
  by them.
- `static readonly template` builds a class from a `.ui` template; its
  `declare`d fields are the template's children by id, and its `<signal
  handler>` names are the class's methods.

## The event loop

A GTK program calls `run` on its application from module evaluation, and GLib's
main loop owns the thread from then on. The GLib host (`nts_glib_host.c`)
attaches one source to the default main context that watches libuv's backend
descriptor and sleeps no longer than libuv's next timer, so timers, promise
jobs and I/O run inside GLib's loop. A signal handler that returns to GLib's
loop ends with a checkpoint, as a task does. While a callback is on the stack,
a nested loop it turns (a modal dialog, a menu, drag and drop) runs no libuv
task, so a handler still runs to completion first, as in JavaScript.

## Memory at the boundary

- **GObjects are counted by their own count.** Under reference counting the
  compiler takes a reference where a second one is kept (`g_object_ref_sink`,
  which also takes a new widget's floating reference) and drops it where the
  last one dies (`g_object_unref`); a program never calls either. `Owned<T>`
  and `Consumed<T>` mark GIR's full transfers. Under `NoGc` nothing is freed.
- **Cycles through GObjects are collected.** A closure capturing the widget
  whose signal it handles is a cycle neither side sees alone. GObject is a
  holder family (`NtsHolders` in `runtime/c/nts_runtime.h`): a GObject's
  signal handlers are the closures it holds, its `ref_count` is read at
  checkpoints, and a garbage cycle is severed by disconnecting the handlers
  ([memory](../foundations/memory.md#cycles-through-foreign-objects)).
- **What GTK lends stays GTK's.** A struct borrowed from an object, such as a
  `GtkTextIter` from its buffer, is valid only while the object lives, and
  nothing in nts keeps the object alive for it.

## Strings at the boundary

A `string` argument crosses as UTF-8 lent for the call (a lone surrogate
becomes U+FFFD; a U+0000 inside the string stops the program); a string
result is copied, and a string a callback returns is a `malloc`ed copy GLib
takes over. `StringView` lends the exact units where a binding wants them
([native](native.md#strings-at-the-boundary)).

## Errors in callbacks

An exception escaping a signal handler is the program's uncaught error. On GTK
the rule is to report it and keep the loop running, as GJS does; that is not
built, and the program stops with status 1 as a command-line program does
([errors](../language/errors.md#callbacks-a-host-invokes)).

## What has run where

GTK programs build and run on Linux x86-64, on both backends, with and without
reference counting, under Xvfb (`GSK_RENDERER=cairo`) in the interop tests of
the full run. `tests/interop/gtk-*` holds them, `gtk-cycles` the cycle tests.
Nothing packages a GTK program beyond its executable.

## Decisions

- The goal is a real GTK 4 application with a GJS-shaped API: closures
  capture, and a GObject's lifetime is tied to its TypeScript value; the
  C-level binding is scaffolding for that, not the product
  ([notebook](../records/notebooks/gtk-lane-goal.md#the-goal)).
- The surface goes beyond GJS: camelCase members imported from `gi:gtk`,
  `gi:gio`, `gi:adw` and the rest, the newest installed GIR unless the config
  pins one; an override keeps the `vfunc` prefix, since it names the class
  struct's slot, not the public method
  ([notebook](../records/notebooks/gtk-lane-goal.md#m5-a-surface-better-than-gjs)).
- An exception escaping a callback on a UI target is reported, and the loop
  keeps running ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- A callback GLib makes on a thread nts does not own is carried to the owner
  thread, and one that must return a value from that thread is refused (C-3,
  I-3; 10-28,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
  Not built.
- The GIR surfaces, being permissively licensed, may be published; surfaces
  are otherwise generated on each machine (B-3; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
