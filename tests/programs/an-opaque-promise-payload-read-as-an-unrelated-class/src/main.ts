// An `Item` settled through a promise where an empty `Handle` is declared,
// and never read through it. The JVM threw ClassCastException here (main
// f6811e8f) while the C lane agreed, then declined the store (NTS4001
// `storing a Item where a Handle is declared`) as a blocker. It refers to a
// face that promises nothing as the root now (`types::root_typed` in
// compiler/codegen/jvm), so the store is an upcast and all four backends
// agree with node.
interface Handle {}
class Item { value = 7; }
async function make(): Promise<Handle> { return new Item(); }
export async function result(n: number): Promise<number> { await make(); return n + 1; }
