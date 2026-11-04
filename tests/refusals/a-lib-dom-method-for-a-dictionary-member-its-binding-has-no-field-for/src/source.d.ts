// A dictionary with a callback member and the binding it would have,
// modeled as src/dash.d.ts models setLineDash's. lib.dom's own such
// dictionaries (UnderlyingSource and its kin) are generic, and a generic
// type reaches lowering as an opaque nominal whose members the snapshot
// does not carry, so a fit cannot key on them there (it keeps the
// stricter rule); this spells the same dictionary non-generically, which
// is the shape whose members are in reach. Two records: one that also
// has a field for the `pull` callback (spelled with a kind a field can
// carry; the member's presence is what the fixture measures, not its
// conversion), declared first and with a further parameter, and one
// holding its data member alone, as a generated dictionary holds the
// members it can carry. With none fitting, the first declared is taken,
// so the shorter record wins a call only by fitting it: which symbol a
// call emits states the fit.
interface PullSourceInit {
  chunkSize?: number;
  pull?: () => void;
}
declare var PullStream: {
  prototype: PullStream;
  new (source?: PullSourceInit): PullStream;
};
/**
 * @ntsBoundBy "nts:dom" PullStream
 */
interface PullStream {}

declare module "nts:dom" {
  import type { ByValue, Fields, HostClass, Struct } from "c:types";
  import type { Float64, Int32 } from "@nts/scalars";
  export type PullStream = HostClass<"NtsPullStream", null, "nts_dom_retain", "nts_dom_release"> & PullStreamMethods;
  export interface PullStreamMethods {}
  export type PullSourceFull = Struct<{ chunkSize: Float64; pull: Float64 }, "NtsPullSourceFull">;
  export type PullSourceInitRecord = Struct<{ chunkSize: Float64 }, "NtsPullSource">;
  /**
   * @ntsSymbol nts_dom_new_PullStream_1_full
   * @ntsDefault extra=0
   */
  export function newPullStream(source: ByValue<PullSourceFull> | Fields<PullSourceFull>, extra?: Int32): PullStream;
  /** @ntsSymbol nts_dom_new_PullStream_1 */
  export function newPullStream(source: ByValue<PullSourceInitRecord> | Fields<PullSourceInitRecord>): PullStream;
}
