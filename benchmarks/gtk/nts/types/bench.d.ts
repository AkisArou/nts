/**
 * @ntsHeader "bench.h"
 */
declare module "c:bench" {
  import type { Float64 } from "@nts/scalars";
  export function bench_now(): Float64;
  export function bench_case(): string;
  export function bench_log(line: string): void;
}
