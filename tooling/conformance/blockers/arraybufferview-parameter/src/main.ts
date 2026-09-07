// expect: a parameter of unrepresentable type (`ArrayBufferView`)
//
// `ArrayBufferView` as a parameter does not lower, alone or in a union, so the
// function is never compiled and the wrapper reports it as absent rather than as
// unrepresentable.
//
// **This is the second gate on `string_decoder`, and I reported that module as
// one fix from green twice before checking it.** Its whole public surface is
// `class StringDecoder`, so `blockers/export-class` looked like the only thing
// in the way. But its methods are
//
//     write(buf: ArrayBufferView | string): string
//     end(buf?: ArrayBufferView): string
//     text(buf: ArrayBufferView, offset: number): string
//
// and none of those three shapes crosses. Publishing the class would publish a
// constructor whose methods could not be called. The claim "one fix from green"
// was assembled from the one blocker I had measured, and the check that
// disproves it — four standalone functions with those exact signatures — took
// two minutes and I ran it only after saying the thing twice.
//
// The reach is wider than one module. `buffer` takes byte views everywhere,
// `fs.read`/`fs.write` take them, `zlib` takes them, and `stream`'s object mode
// passes them through. Anything that moves bytes across the Node-API boundary in
// this profile wants this.
//
// `ctorLike(encoding?: string): number` and a nullary `(): number` publish fine
// in the same file, so it is these parameter types specifically and not the
// module or the arity.
//
// **Two different failures live behind "a byte view does not cross", and they
// want different work.** Measured side by side in one file:
//
//     function f(values: number[])   -> published
//     function f(bytes: Uint8Array)  -> "takes TypedArray:
//                                        its signature does not cross"
//     function f(buf: ArrayBufferView) -> "a parameter of unrepresentable type"
//
// A `Uint8Array` parameter **lowers**. The function is compiled and only the
// Node-API wrapper declines to carry it, which is the same place `f64-parameter`
// was fixed and is therefore a known kind of work. `ArrayBufferView` does not
// lower at all, because it is an interface rather than a concrete view type, so
// it needs the lowering *and* then the wrapper.
//
// That distinction decides how much of `string_decoder` this costs. Its methods
// take `ArrayBufferView` because node's accept any view; if they took
// `Uint8Array` only the wrapper half would be missing. It also means a fix that
// stops at `Uint8Array` — which is the obvious first step and the one
// `f64-parameter` suggests — publishes nothing for this module.
export function writeView(buf: ArrayBufferView): string {
  return buf.byteLength.toString();
}

export function writeUnion(buf: ArrayBufferView | string): string {
  return typeof buf === "string" ? buf : buf.byteLength.toString();
}

export function endOptional(buf?: ArrayBufferView): string {
  return buf === undefined ? "" : buf.byteLength.toString();
}
