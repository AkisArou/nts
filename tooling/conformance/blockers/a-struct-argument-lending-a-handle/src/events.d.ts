/** @ntsHeader "events.h" */
declare module "nts:events" {
  import type { ByValue, CBool, Fields, HostClass, Struct } from "c:types";
  import type { Uint8 } from "@nts/scalars";
  export type Target = HostClass<"Target", null, "target_retain", "target_release">;
  /** MouseEventInit's shape: a nullable handle member (relatedTarget) beside a boolean. */
  export type Init = Struct<{ relatedTarget: Target | null; bubbles: CBool<Uint8> }, "EventInit">;
  /** @ntsSymbol target_make */
  export function makeTarget(): Target;
  /** @ntsSymbol event_new */
  export function newEvent(init: ByValue<Init> | Fields<Init>): void;
}
