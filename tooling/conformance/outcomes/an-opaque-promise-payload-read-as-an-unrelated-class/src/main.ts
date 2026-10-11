// run: check
// backend: jvm
interface Handle {}
class Item { value = 7; }
async function make(): Promise<Handle> { return new Item(); }
export async function result(n: number): Promise<number> { await make(); return n + 1; }
