// The control for a-save-through-an-interface-whose-only-implementer-maps-
// with-a-named-function (tests/refusals): the same program with the map
// callback written as an arrow at the call. The implementer compiles, the
// interface dispatch has a body, and every backend agrees with node.

export interface Rec { readonly name: string; readonly n: number; }
function cloneRec(r: Rec): Rec { return { name: r.name, n: r.n }; }
export interface Store {
  saveAll(items: readonly Rec[]): Promise<void>;
}
export class MemStore implements Store {
  private items: Rec[] = [];
  async saveAll(items: readonly Rec[]): Promise<void> {
    this.items = items.map((r) => cloneRec(r));
  }
}
class Jar {
  private readonly store: Store = new MemStore();
  private items: Rec[] = [];
  private async save(items: Rec[]): Promise<void> {
    await this.store.saveAll(items);
    this.items = items;
  }
  async put(seed: number): Promise<number> {
    await this.save([{ name: "a", n: seed }]);
    return this.items.length + ((seed | 0) & 1);
  }
}
export async function callIt(seed: number): Promise<number> {
  return await new Jar().put(seed);
}
