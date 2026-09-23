// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "gir.h"
 */
declare module "c:gir-shim" {
  import type { Closure, c_int, c_ulong } from "c:types";
  import type { GObject } from "c:GObject-2.0";
  import type { GApplication } from "c:Gio-2.0";

  export function gir_connect(instance: GObject, signal: string, handler: Closure<(instance: GObject) => void>): c_ulong;
  export function gir_run(app: GApplication): c_int;
  export function gir_unref(object: GObject): void;
  export function gir_log(line: string): void;
}
