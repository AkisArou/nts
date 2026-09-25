// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "shim.h"
 */
declare module "c:react-gtk-shim" {
  import type { GObject } from "c:GObject-2.0";

  export function react_gtk_emit(instance: GObject, signal: string): void;
  export function react_gtk_log(line: string): void;
}
