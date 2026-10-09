// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "tasks.h"
 */
declare module "c:tasks" {
  import type { Float64 } from "@nts/scalars";
  export function tasks_now(): Float64;
  export function tasks_log(line: string): void;
}
