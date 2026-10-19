/*---
description: A type parameter constrained to a class reads the class's members and returns the subclass instance it was given.
features: [ts-generics, ts-generic-constraints, ts-class, ts-inheritance]
---*/
class Coin {
  constructor(public cents: number) {}
}
class GoldCoin extends Coin {
  shine(): string {
    return `gold ${this.cents}`;
  }
}
function richest<T extends Coin>(coins: T[]): T {
  let best = coins[0];
  for (const coin of coins) if (coin.cents > best.cents) best = coin;
  return best;
}
const big = new GoldCoin(50);
const winner = richest([new GoldCoin(5), big, new GoldCoin(20)]);
assert.sameValue(winner, big);
assert.sameValue(winner.shine(), "gold 50");
assert.sameValue(richest([new Coin(1), new Coin(2)]).cents, 2);
