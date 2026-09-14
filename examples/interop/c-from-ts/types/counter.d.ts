// Hand-written declarations for native/counter.h.
declare module "c:counter" {
  import type { c_int, Opaque } from "c:types";

  // An opaque C pointee, not a managed TypeScript object.
  export type Counter = Opaque<"Counter">;

  export function counter_clamp(value: c_int, lo: c_int, hi: c_int): c_int;
  export function counter_new(initial: c_int): Counter | null;
  export function counter_bump(counter: Counter, by: c_int): c_int;
  export function counter_read(counter: Counter): c_int;
  export function counter_destroy(counter: Counter): void;
  export function counter_live(): c_int;
}
