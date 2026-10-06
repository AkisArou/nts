import { read } from "nts:managed-opaque-reduction";
import type { Opaque } from "c:types";
export function managedOpaque(context: Opaque<"Context">): string {
  return read(context);
}
