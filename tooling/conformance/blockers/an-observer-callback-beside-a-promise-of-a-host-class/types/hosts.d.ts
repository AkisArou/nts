declare module "x:hosts" {
  import type { Closure, HostClass, c_int } from "c:types";
  export type Node = HostClass<"XNode", null, "x_retain", "x_release">;
  export type Records = HostClass<"XRecords", null, "x_records_retain", "x_records_release">;
  /** @ntsSymbol x_ready */
  export function ready(): Promise<Node>;
  /** @ntsSymbol x_observe */
  export function observe(callback: Closure<(records: Records) => void>): c_int;
  /** @ntsSymbol x_records_length */
  export function recordsLength(records: Records): c_int;
}
