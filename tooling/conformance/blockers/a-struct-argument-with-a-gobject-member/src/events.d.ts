/** @ntsHeader "events.h" */
declare module "nts:gevents" {
  import type { ByValue, CBool, Fields, GObjectClass, Struct, c_uint8 } from "c:types";
  export type Target = GObjectClass<"GTarget">;
  export type Init = Struct<{ relatedTarget: Target | null; bubbles: CBool<c_uint8> }, "EventInit">;
  /** @ntsSymbol gtarget_make */
  export function makeTarget(): Target;
  /** @ntsSymbol gevent_new */
  export function newEvent(init: ByValue<Init> | Fields<Init>): void;
}
