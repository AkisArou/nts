// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "tasks.h"
 */
declare module "c:tasks" {
  import type { c_double } from "c:types";
  export function tasks_now(): c_double;
  export function tasks_log(line: string): void;
}
