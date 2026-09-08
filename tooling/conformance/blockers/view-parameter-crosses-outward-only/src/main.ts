// expect: emit-c --napi -> no wrapper for width: is exported and its signature
//          does not cross
//
// The control for `view-returned-to-the-host`, and the reason that one is not
// simply "views cross now".
//
// Outward, the wrapper reads bytes this heap already owns and copies them. A
// view *parameter* would have to allocate the storage on this side, which is
// the same asymmetry an object has -- `Cross::Object` is refused as a parameter
// because allocation needs the layout's descriptor and `program.c` keeps its
// own to itself.
//
// Without this fixture the pair reads as "typed arrays cross", and the first
// person to write a wrapper taking one would find out otherwise from a refusal
// rather than from a test.
//
// **The message here is the generic one, and a specific one was computed and
// thrown away.** `crossings_of` refuses this parameter with "takes
// `Uint8Array`, which crosses outward only", and the export pass at the bottom
// of `napi/src/lib.rs` re-derives a reason from the symbol instead of carrying
// that one -- so a reader is told the signature does not cross and not which
// half of it, or which direction. That file's own comment argues against
// exactly this: "Two different causes, and they send a reader to different
// places", written after saying "is not a function" for both cost the Node
// session a build. The same trade is still being made one level down. Left as
// the expectation because it is what happens, not because it is right.

export function width(bytes: Uint8Array): number {
  return bytes.length;
}
