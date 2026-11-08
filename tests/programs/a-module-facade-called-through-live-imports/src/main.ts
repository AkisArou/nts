// Control for a-module-namespace-kept-in-a-lazy-global: retain a live import
// and read it only when called, as the ZIP codec adapters do.
import { value } from "./facade.ts";

export function throughFacade(n: number): number {
  return value(n);
}
