// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "sub.h"
 */
declare module "c:sub" {
  import type { GObject } from "c:GObject-2.0";

  export function sub_emit(instance: GObject, signal: string): void;
  export function sub_log(line: string): void;
}
