/** @ntsHeader "observer.h" */
declare module "nts:observer" {
  import type { ByValue, CBool, Fields, StringView, Struct } from "c:types";
  import type { Uint8 } from "@nts/scalars";
  /** IntersectionObserverInit's shape: a string member beside a boolean. */
  export type Init = Struct<{ rootMargin: StringView; trackVisibility: CBool<Uint8> }, "ObserverInit">;
  /** @ntsSymbol observer_observe */
  export function observe(init: ByValue<Init> | Fields<Init>): void;
}
