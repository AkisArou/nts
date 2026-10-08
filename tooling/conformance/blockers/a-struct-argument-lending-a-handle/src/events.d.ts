/** @ntsHeader "events.h" */
declare module "nts:events" {
  import type { ByValue, CBool, Fields, HostClass, Struct, c_uint8 } from "c:types";
  export type Target = HostClass<"Target", null, "target_retain", "target_release">;
  /** MouseEventInit's shape: a nullable handle member (relatedTarget) beside a boolean. */
  export type Init = Struct<{ relatedTarget: Target | null; bubbles: CBool<c_uint8> }, "EventInit">;
  /** @ntsSymbol target_make */
  export function makeTarget(): Target;
  /** @ntsSymbol event_new */
  export function newEvent(init: ByValue<Init> | Fields<Init>): void;
}
