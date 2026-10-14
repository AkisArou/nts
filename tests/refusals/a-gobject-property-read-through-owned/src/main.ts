// expect: NTS1001 a property read through a native pointer is not supported by this lowering yet
//
// A program's own GObject class (`class Book extends GObject<Book>`, its
// `title` declared with `property("")`) read back through `Owned<T>`: a
// hand-written typed view of `g_list_model_get_object`, which answers
// `Owned<GObject>` in the binding, narrowed by the generic to the program's
// class. Reading `item.title` -- a field of the program class's state object
// -- is refused, so no typed list model can hand its items back.
// Measured with the compiler built from main d753577a6 (this tree):
// the probe this fixture is reduced from (target/muse/probe6a on the
// GTK lane) refuses at the same read. Judged by blockers-check since
// d753577a6 gave config-less projects the GIR bindings in every command.
//
// Control, measured as compiling on the same binary: the identical generic
// answering `T | null` without `Owned` (probe6a-control) builds with no
// refusal; only the `Owned` wrapper changes.
//
// When this is fixed the fixture reads FIXED in blockers-check; the witness
// then belongs in a typed `ListModel<T>` (GTK lane slice 2).
import { GObject, property } from "gi:gobject";
import type { Owned, ClassChain } from "c:types";
import type { c_uint } from "@nts/scalars";

class Book extends GObject<Book> {
  title = property("");
}

/** @ntsSymbol g_list_model_get_object */
declare function getItem<T extends ClassChain>(model: GObject, index: c_uint): Owned<T> | null;

// The control beside it, which must stay clean: the same field read
// directly on the program's class, with no `Owned` between.
export function readDirect(book: Book): string {
  return book.title;
}

export function readTitle(model: GObject): string {
  const item = getItem<Book>(model, 0 as c_uint);
  if (item === null) return "none";
  return item.title;
}
