/** @ntsHeader "host.h" */
declare module "host" {
  import type { Closure } from "c:types";
  import type { Int32 } from "@nts/scalars";
  export type Handler = Closure<(event: Int32) => void>;
  /** The handler the host holds for `target`, which the program set. */
  export function handler_get(target: Int32): Handler;
  export function handler_set(target: Int32, handler: Handler): void;
}
