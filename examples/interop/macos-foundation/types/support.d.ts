// Hand-written. The fixture's output line, and the autorelease pool the
// program pushes around its sends: `objc_autoreleasePoolPush`/`Pop` are C
// functions libobjc exports, declared in no public header.
/**
 * @ntsHeader "report.h"
 */
declare module "c:report" {
  import type { Opaque } from "c:types";
  export type Pool = Opaque<"nts_pool">;
  export function report(line: string): void;
  export function objc_autoreleasePoolPush(): Pool;
  export function objc_autoreleasePoolPop(pool: Pool): void;
}
