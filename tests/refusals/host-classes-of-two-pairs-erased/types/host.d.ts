declare module "x:hosts" {
  import type { HostClass } from "c:types";
  export type Node = HostClass<"XNode", null, "x_retain", "x_release">;
  export type Sequence = HostClass<"XSequence", null, "x_sequence_retain", "x_sequence_release">;
}
