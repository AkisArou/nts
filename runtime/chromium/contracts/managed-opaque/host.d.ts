declare module "nts:managed-opaque-reduction" {
  import type { Opaque } from "c:types";
  /** @ntsAbi managed */
  export function read(context: Opaque<"Context">): string;
}
