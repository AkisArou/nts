/** @ntsHeader "host.h" */
declare module "host" {
  import type { Closure, CNumber } from "c:types";
  export type Handler = Closure<(event: CNumber<"int32">) => void>;
  /** The handler the host holds for `target`, which the program set. */
  export function handler_get(target: CNumber<"int32">): Handler;
  export function handler_set(target: CNumber<"int32">, handler: Handler): void;
}
