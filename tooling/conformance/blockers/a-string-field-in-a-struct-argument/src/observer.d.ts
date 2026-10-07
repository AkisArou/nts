/** @ntsHeader "observer.h" */
declare module "nts:observer" {
  import type { ByValue, CBool, Fields, StringView, Struct, c_uint8 } from "c:types";
  /** IntersectionObserverInit's shape: a string member beside a boolean. */
  export type Init = Struct<{ rootMargin: StringView; trackVisibility: CBool<c_uint8> }, "ObserverInit">;
  /** @ntsSymbol observer_observe */
  export function observe(init: ByValue<Init> | Fields<Init>): void;
}
