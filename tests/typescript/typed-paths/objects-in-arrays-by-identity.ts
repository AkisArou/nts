/*---
description: indexOf and includes find class instances in a typed array by identity, not by shape.
features: [ts-arrays, ts-class]
---*/
class Tile {
  constructor(public x: number, public y: number) {}
}
const a = new Tile(0, 0);
const tiles: Tile[] = [a, new Tile(1, 0)];
assert.sameValue(tiles.indexOf(a), 0);
assert.sameValue(tiles.indexOf(new Tile(0, 0)), -1);
assert.sameValue(tiles.includes(new Tile(1, 0)), false);
assert.sameValue(tiles.findIndex((t) => t.x === 1), 1);
