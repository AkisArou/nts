// expect: emit-jvm -> storing a `Item` where a `Handle` is declared
// Main f6811e8f aborts with ClassCastException; the C lane agrees.
interface Handle {}
class Item { value = 7; }
async function make(): Promise<Handle> { return new Item(); }
export async function result(n: number): Promise<number> { await make(); return n + 1; }
