// Hand-written: the runtime's live-object count, through `native/live.h`.
/**
 * @ntsHeader "live.h"
 */
declare module "c:live" {
  import type { c_size_t } from "@nts/scalars";
  export function cairo_fixture_live(): c_size_t;
}
