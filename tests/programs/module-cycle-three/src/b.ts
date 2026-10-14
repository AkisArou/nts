import { fromC } from "./c.js";

export function fromB(): number {
  return fromC() + 10;
}
