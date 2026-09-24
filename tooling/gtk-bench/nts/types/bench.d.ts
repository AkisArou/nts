/**
 * @ntsHeader "bench.h"
 */
declare module "c:bench" {
  import type { c_double } from "c:types";
  export function bench_now(): c_double;
  export function bench_case(): string;
  export function bench_log(line: string): void;
}
