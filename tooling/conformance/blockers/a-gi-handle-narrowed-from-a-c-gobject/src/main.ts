// expect: NTS1001 an opaque C pointer converted to a different representation is not supported by this lowering yet
//
// The two surfaces of one binding disagree about a handle's
// representation: a value that arrives as the `c:` surface's erased
// `GObject` (as the corpus host's builder hands it over), narrowed by
// `instanceof` to the `gi:` surface's class for the same C type, cannot
// then be used through that class's typed members. `connect` crosses
// (its receiver is erased), so a connect-only port converts; a property
// write does not, so most ports cannot move to `gi:` while the host
// stays on `c:`. The surfaces are one binding renamed, so the handle
// should be one representation.
// Measured with the compiler built from main d753577a6 (this tree);
// reduced from Slice 1's banner/action-bar/calendar conversions, each
// refused at its first typed member on a builder object.
//
// Control beside it, which must stay clean: the same narrowing with
// only the test itself, and the same write on a value that arrives
// typed by the `c:` surface throughout.
import { GObject } from "c:GObject-2.0";
import { GtkButton } from "c:Gtk-4.0";
import { Button } from "gi:gtk";

export function xsurfCase(object: GObject): string {
  if (object instanceof Button) { object.label = "x"; return object.label ?? ""; }
  return "none";
}

export function xsurfControl(object: GObject): string {
  return object instanceof Button ? "button" : "none";
}

export function xsurfTyped(button: GtkButton): void {
  button.label = "x";
}
