// Hand-written: the fixture's output. The application itself needs no C --
// `UIApplicationMain` is the binding's and `exit` is `c:stdlib`'s.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  export function report(line: string): void;
}
