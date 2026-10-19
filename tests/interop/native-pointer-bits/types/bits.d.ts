/** @ntsHeader "bits.h" */
declare module "c:pointer-bits" {
  import type { Class, ConstPtr, Opaque } from "c:types";
  import type { Uint16 } from "@nts/scalars";

  export type Item = Opaque<"Item">;
  export type Base = Class<"Base">;
  export type Window = Class<"Window", Base>;

  export function bits_text(): ConstPtr<Uint16>;
}
