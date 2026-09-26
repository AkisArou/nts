// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "shim.h"
 */
declare module "c:react-gtk-shim" {
  import type { GObject } from "c:GObject-2.0";
  import type { CNumber } from "c:types";

  export function react_gtk_emit(instance: GObject, signal: string): void;
  export function react_gtk_emit_double(instance: GObject, signal: string, value: CNumber<"double">): void;
  export function react_gtk_emit_decision(instance: GObject, signal: string): CNumber<"int">;
  export function react_gtk_log(line: string): void;
}
