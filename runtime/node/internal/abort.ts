// What this profile needs of an `AbortSignal`.
//
// A structural type rather than the DOM one, because the DOM's is not in the
// library this profile compiles against and because nothing here needs the
// whole of it: a signal is something that is or is not aborted, carries a
// reason, and can be listened to once.
//
// It lives here because more than one module wants it -- `node:stream` takes
// one on almost every operation, `node:readline` takes one per interface and
// per question -- and a shape defined twice is a shape that drifts. That is
// the same rule this directory's `bindings.node.mjs` states about bindings,
// applied to types.

export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
