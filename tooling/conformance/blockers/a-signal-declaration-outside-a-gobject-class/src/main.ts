// expect: NTS1001 a `signal(...)` that is not the initialiser of a field of a class over a `GObject` class: it declares one of that class's signals, and is no value anywhere else
//
// `readonly incremented = signal<[by: number]>()` declares a signal of a class
// the program writes over a `GObject` class (`c:types`, re-exported by
// `gi:gobject`), emitted and connected by its name; the field holds nothing.
// Anywhere but such a field it would silently be a value that declares
// nothing, so it is refused by name, as `property(...)` is
// (`a-property-declaration-outside-a-gobject-class`).
//
// Control, measured as compiling: the same field in a class extending
// `Button<Tally>` (examples/interop/gtk-gi's `Tally`).
import { signal } from "c:types";

class Plain {
  readonly changed = signal<[to: number]>();
}

export function made(): boolean {
  return new Plain().changed !== undefined;
}
