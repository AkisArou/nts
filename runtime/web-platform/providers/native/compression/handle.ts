import type { NativeCompressionBrand } from "./handle-brand.d.ts";

/** Native state is owned by an NtsBoxed finalizer, never by a numeric registry. */
export interface NativeCompressionHandle extends NativeCompressionBrand {}
export class NativeCompressionHandle {
  private constructor() {}
}
