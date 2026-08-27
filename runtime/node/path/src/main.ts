// `node:path`.
//
// The module exports the platform's own half directly and both halves by name,
// which is what node does: on a posix host `path.normalize` is
// `path.posix.normalize`, and `path.win32.normalize` is still reachable, because
// a program that manipulates Windows paths should not have to run on Windows.
//
// The split into `posix.ts` and `win32.ts` is upstream's too -- `lib/path.js`
// holds two object literals over a shared set of helpers. Here they are two
// modules over `internal.ts`, which is the same arrangement with the sharing
// made explicit rather than implied by file scope.

export * from "./posix.ts";
export * as posix from "./posix.ts";
export * as win32 from "./win32.ts";
export type { FormatInputPathObject, ParsedPath } from "./internal.ts";
