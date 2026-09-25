// Hand-written: output, and the application's start and end.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { c_int } from "c:types";
  export function report(line: string): void;
  export function ios_main(delegate: string): void;
  export function ios_exit(code: c_int): void;
}
