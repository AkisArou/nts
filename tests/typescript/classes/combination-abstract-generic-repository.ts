/*---
description: An abstract generic class over an interface, with a private map and a static count, two subclasses at two types.
features: [ts-class, ts-abstract, ts-generics, ts-interfaces, ts-private-fields, ts-static]
---*/
interface Entity {
  id: number;
}
abstract class Repository<T extends Entity> {
  static created = 0;
  #items = new Map<number, T>();
  constructor() {
    Repository.created++;
  }
  add(item: T): this {
    this.#items.set(item.id, item);
    return this;
  }
  find(id: number): T | undefined {
    return this.#items.get(id);
  }
  abstract describe(item: T): string;
}
class Users extends Repository<{ id: number; login: string }> {
  describe(item: { id: number; login: string }): string {
    return `@${item.login}`;
  }
}
class Prices extends Repository<{ id: number; cents: number }> {
  describe(item: { id: number; cents: number }): string {
    return (item.cents / 100).toFixed(2);
  }
}
const users = new Users().add({ id: 1, login: "kim" });
const prices = new Prices().add({ id: 7, cents: 1250 });
assert.sameValue(users.describe(users.find(1)!), "@kim");
assert.sameValue(prices.describe(prices.find(7)!), "12.50");
assert.sameValue(prices.find(2), undefined);
assert.sameValue(Repository.created, 2);
