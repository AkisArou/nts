import { core } from "./facade.js";
import { decorated } from "./base.js";

export function throughTheFacade(n: number): number {
  return core(n) + decorated(n);
}
