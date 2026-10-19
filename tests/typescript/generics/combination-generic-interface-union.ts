/*---
description: A constrained generic class implementing a generic interface, instantiated over a union of a class and number, over number, and over an object type.
features: [ts-generics, ts-generic-constraints, ts-class, ts-interfaces, ts-unions]
---*/
interface Ranked<T> {
  best(): T;
  add(item: T): this;
}
class Leaderboard<T extends { score(): number } | number> implements Ranked<T> {
  private items: T[] = [];
  add(item: T): this {
    this.items.push(item);
    return this;
  }
  best(): T {
    const rank = (item: T): number => (typeof item === "number" ? item : item.score());
    return this.items.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  }
}
class Player {
  constructor(readonly points: number) {}
  score(): number {
    return this.points;
  }
}
const star = new Player(9);
const mixed: Ranked<Player | number> = new Leaderboard<Player | number>().add(4).add(star).add(7);
assert.sameValue(mixed.best(), star);
assert.sameValue(new Leaderboard<number>().add(1).add(3).add(2).best(), 3);
const scorer = { score: (): number => 11 };
assert.sameValue(new Leaderboard<typeof scorer>().add(scorer).best().score(), 11);
