// Hand-written. The shim's loop, and CoreFoundation, which it calls: a C
// framework named by `@ntsFramework` as a message's would be.
/**
 * @ntsHeader "loop.h"
 * @ntsFramework CoreFoundation
 */
declare module "c:loop" {
  export function loop_log(line: string): void;
  export function loop_run(): void;
  export function loop_stop(): void;
  export function loop_event_later(event: () => void): void;
  export function loop_event_now(event: () => void): void;
  export function loop_control(): void;
}
