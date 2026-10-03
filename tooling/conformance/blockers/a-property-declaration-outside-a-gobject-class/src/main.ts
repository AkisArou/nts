// expect: NTS1001 a `property(...)` that is not the initialiser of a field of a class over a `GObject` class: it declares one of that class's properties, and is no value anywhere else
//
// `property(default)` declares a property of a class the program writes over
// a `GObject` class, as its field's initialiser (`c:types`, re-exported by
// `gi:gobject`). It is lowered to its default only there, where the field's
// type makes it a property; anywhere else it would silently be a value that
// declares nothing, so it is refused by name.
//
// Control, measured as compiling: the same class extending `GObject`
// (examples/interop/gtk-gi's `Book`).
import { property } from "c:types";

class Plain {
  title = property("x");
}

export function read(): string {
  return new Plain().title;
}
