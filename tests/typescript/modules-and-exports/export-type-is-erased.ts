/*---
description: An exported type and interface are erased; a value of the same name is the module's only binding of it.
features: [ts-modules, ts-exports, ts-declaration-merging]
flags: [module]
---*/
export type Point = { x: number; y: number };
export interface Sized {
  size: number;
}
export const Point = (x: number, y: number): Point => ({ x, y });
const p: Point = Point(1, 2);
const s: Sized = { size: p.x + p.y };
assert.sameValue(s.size, 3);
assert.sameValue(typeof Point, "function");
