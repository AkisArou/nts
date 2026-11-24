/** @ntsHeader "target.h" */
declare module "nts:gtarget" {
  import type { GObjectClass } from "c:types";
  export type Target = GObjectClass<"GTarget">;
  /** @ntsSymbol gtarget_make */
  export function makeTarget(): Target;
}
