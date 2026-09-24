// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "cycles.h"
 */
declare module "c:cycles" {
  import type { GObject } from "c:GObject-2.0";
  import type { c_int, c_size_t } from "c:types";

  export function cycles_track(object: GObject): void;
  export function cycles_finalized(): c_int;
  export function cycles_candidates(): c_size_t;
  export function cycles_emit_later(object: GObject): void;
  export function cycles_drop(): void;
  export function cycles_log(line: string): void;
}
