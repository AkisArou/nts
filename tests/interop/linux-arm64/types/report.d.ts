// Hand-written. `line` is NUL-terminated UTF-8, borrowed for the call.
/**
 * @ntsHeader "report.h"
 */
declare module "c:report" {
  export function report(line: string): void;
}
