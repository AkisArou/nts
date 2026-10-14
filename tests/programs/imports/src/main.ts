import { distance, type Point } from "./geometry.js";

export function origin(): Point {
  return { x: 0, y: 0 };
}

// A call across a module boundary: the callee is declared in geometry.ts.
export function reach(p: Point): number {
  return distance(origin(), p);
}

import { scale } from "../vendor/helper.js";
export function scaled(n: number): number {
  return scale(n, 2);
}
