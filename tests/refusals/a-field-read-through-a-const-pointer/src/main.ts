// expect: NTS1001 a property read through a native pointer is not supported by this lowering yet
//
// **A record's field read through a `const` pointer to it.** `view.x`, with
// `view` a `ConstPtr<Point>`, is C's `view->x`: a read, which `const`
// permits, and which `ConstPtr` projects as a readonly field. Lowering
// refuses it: it reads a field through a pointer whose pointee is the
// record, and a `ConstPtr`'s pointee is the record made `const`. Bindings
// hand such pointers back -- `gtk_svg_error_get_start` answers `const
// GtkSvgLocation *` -- and gtk-gir copies one whole into the program's
// storage (`copy`) to read it. Found by the Sdk lane writing that witness.
//
// Control, one difference -- the same field read through the `Ptr` the
// `ConstPtr` is made from -- `written` below, which must stay clean.
import { local } from "c:memory";
import type { ConstPtr, Struct } from "c:types";
import type { c_int } from "@nts/scalars";

type Point = Struct<{ x: c_int; y: c_int }>;

export function written(): number {
  const point = local<Point>();
  point.x = 3;
  return point.x;
}

export function read(): number {
  const point = local<Point>();
  point.x = 3;
  const view: ConstPtr<Point> = point;
  return view.x;
}
