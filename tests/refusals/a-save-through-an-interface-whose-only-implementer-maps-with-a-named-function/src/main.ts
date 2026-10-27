// expect: emit-c --napi -> no declaration for `Store#saveAll` to take a signature from
//
// One of the web-platform blocker's six backend declines, reduced
// (2026-10-27): `CookieJarStore#saveAll` (jar.ts:479) and its cascade
// `CookieJar#save`. The only implementer in the program maps with a
// named function (`items.map(cloneRec)`), which lowering refuses, so
// the interface dispatch has no compiled body anywhere. The async
// caller's resume half survives lowering with the virtual call intact,
// and the backend declines it for want of a declaration (NTS2006)
// instead of lowering refusing the caller. The control with an arrow
// callback is a-save-through-an-interface-whose-implementer-maps-with-an-arrow.
// Runtime-source shape plus cascade presentation: the map limitation is
// lowering's, the surviving call is the compiler gap this pins.

export interface Rec { readonly name: string; readonly n: number; }
function cloneRec(r: Rec): Rec { return { name: r.name, n: r.n }; }
export interface Store {
  saveAll(items: readonly Rec[]): Promise<void>;
}
export class MemStore implements Store {
  private items: Rec[] = [];
  async saveAll(items: readonly Rec[]): Promise<void> {
    this.items = items.map(cloneRec);
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
