// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "sub.h"
 */
declare module "c:sub" {
  import type { GObject } from "c:GObject-2.0";
  import type { CBool, c_int } from "c:types";

  export function sub_emit(instance: GObject, signal: string): void;
  export function sub_log(line: string): void;
  export function sub_watch(instance: GObject): void;
  export function sub_gone(): CBool<c_int>;
}
