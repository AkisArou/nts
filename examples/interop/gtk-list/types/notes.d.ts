// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "notes.h"
 */
declare module "c:notes" {
  import type { GObject } from "c:GObject-2.0";

  export function notes_emit(instance: GObject, signal: string): void;
  export function notes_log(line: string): void;
}
