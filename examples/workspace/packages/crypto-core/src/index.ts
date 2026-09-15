// One C implementation behind a TypeScript surface, for every target including
// the Node addon. Nothing here is platform-conditional.
import { digest32 } from "c:digest";
import type { c_int } from "c:types";

export function digest(bytes: Uint8Array): number {
  return digest32(bytes, bytes.length as c_int);
}
