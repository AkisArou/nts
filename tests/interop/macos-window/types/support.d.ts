// Hand-written. Output, the control switch, and the method implementations
// blocks make: `imp_implementationWithBlock`, typed once for a button's
// action, the block taking `self` first.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { Block } from "objc:types";
  import type { Implementation } from "objc:runtime";
  import type { NSEvent, NSObject, NSView, Timer } from "objc:AppKit";
  import type { Float64 } from "@nts/scalars";
  /** `WINDOW_CONTROL=detached` takes libuv's sources off the run loop. */
  export function window_control(): void;
  /** Under `WINDOW_NESTED=1`, a nested run loop inside the callback. */
  export function nested_while_readable(): void;
  /** Sends `view` `isFlipped`, as AppKit asks it. */
  export function view_is_flipped(view: NSView): boolean;
  /** Sends `view` `drawRect:` with a rectangle, as AppKit does. */
  export function send_draw_rect(view: NSView, x: Float64, y: Float64, width: Float64, height: Float64): void;
  export function send_mouse_down(view: NSView, event: NSEvent): void;
  export function view_intrinsic_size(view: NSView): Float64;
  export function view_alignment_rect(view: NSView): Float64;
  /**
   * @ntsSymbol imp_implementationWithBlock
   */
  export function actionImplementation(block: Block<(self: NSObject, sender: NSObject) => void>): Implementation;
}
