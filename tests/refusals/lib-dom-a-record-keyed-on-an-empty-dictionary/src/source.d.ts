// A generic dictionary declaring no members and the binding it would
// have, modeled as the modeled PullStream binding is: the constructor
// is generic in the dictionary's parameter, as the stream
// constructors this shape comes from are. Two records at one parameter
// each, the one holding `size` alone declared first, so it wins a
// call only by fitting it ahead of the one that also has a field for
// `tag` -- which symbol a call emits states the fit. (Capture today
// carries this dictionary to the fit as an object type; the fit must
// answer the same if it ever arrives as the opaque nominal the
// snapshot's symbol index answers for, which is the arm where a
// known-empty member list was once read as no dictionary.)
interface EmptyInit<T> {}
declare var EmptyStream: {
  prototype: EmptyStream;
  new <T>(source?: EmptyInit<T>): EmptyStream;
};
/**
 * @ntsBoundBy "nts:dom" EmptyStream
 */
interface EmptyStream {}

declare module "nts:dom" {
  import type { ByValue, Fields, HostClass, Struct } from "c:types";
  import type { Float64 } from "@nts/scalars";
  export type EmptyStream = HostClass<"NtsEmptyStream", null, "nts_dom_retain", "nts_dom_release"> & EmptyStreamMethods;
  export interface EmptyStreamMethods {}
  export type EmptyBare = Struct<{ size: Float64 }, "NtsEmptyBare">;
  export type EmptyFull = Struct<{ size: Float64; tag: Float64 }, "NtsEmptyFull">;
  /** @ntsSymbol nts_dom_new_EmptyStream_1 */
  export function newEmptyStream(source: ByValue<EmptyBare> | Fields<EmptyBare>): EmptyStream;
  /** @ntsSymbol nts_dom_new_EmptyStream_1_full */
  export function newEmptyStream(source: ByValue<EmptyFull> | Fields<EmptyFull>): EmptyStream;
}
