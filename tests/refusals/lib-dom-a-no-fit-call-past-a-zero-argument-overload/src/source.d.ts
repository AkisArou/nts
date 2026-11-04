// The binding beside src/main.ts, modeled as the modeled PullStream
// binding is: a zero-argument constructor overload, a lent sequence,
// and a dictionary record, in that declaration order, for a checked
// parameter a DOMPointReadOnly satisfies -- so which candidate a
// no-fit call is refused by states which one the fallback took.
interface DashInit {
  x?: number;
  y?: number;
}
declare var DashStream: {
  prototype: DashStream;
  new (source?: DashInit | number[]): DashStream;
};
/**
 * @ntsBoundBy "nts:dom" DashStream
 */
interface DashStream {}

declare module "nts:dom" {
  import type { ByValue, CElements, Counted, Fields, HostClass, Struct } from "c:types";
  import type { c_size_t, Float64 } from "@nts/scalars";
  export type DashStream = HostClass<"NtsDashStream", null, "nts_dom_retain", "nts_dom_release"> & DashStreamMethods;
  export interface DashStreamMethods {}
  export type DashRecord = Struct<{ x: Float64; y: Float64 }, "NtsDashInit">;
  /** @ntsSymbol nts_dom_new_DashStream_0 */
  export function newDashStream(): DashStream;
  /** @ntsSymbol nts_dom_new_DashStream_1_segments */
  export function newDashStream(segments: Counted<CElements<Float64Array, "const double">, c_size_t>): DashStream;
  /** @ntsSymbol nts_dom_new_DashStream_1 */
  export function newDashStream(source: ByValue<DashRecord> | Fields<DashRecord>): DashStream;
}
