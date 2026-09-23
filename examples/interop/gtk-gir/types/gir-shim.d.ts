// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "gir.h"
 */
declare module "c:gir-shim" {
  import type { GObject } from "c:GObject-2.0";

  export function gir_emit(instance: GObject, signal: string): void;
  export function gir_log(line: string): void;
}
