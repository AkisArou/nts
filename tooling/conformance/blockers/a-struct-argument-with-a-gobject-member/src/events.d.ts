/** @ntsHeader "events.h" */
declare module "nts:gevents" {
  import type { ByValue, CBool, Fields, GObjectClass, Struct } from "c:types";
  import type { Uint8 } from "@nts/scalars";
  export type Target = GObjectClass<"GTarget">;
  export type Init = Struct<{ relatedTarget: Target | null; bubbles: CBool<Uint8> }, "EventInit">;
  /** @ntsSymbol gtarget_make */
  export function makeTarget(): Target;
  /** @ntsSymbol gevent_new */
  export function newEvent(init: ByValue<Init> | Fields<Init>): void;
}
