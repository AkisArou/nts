// A cache entry read by prefix from an erased array, through an
// inheriting face: `Entry extends Metadata`, both carrying state, held
// by `DurableEntry`, which extends neither. This was a JVM refusal
// (`Entry` carries state; before that, on f6811e8f, a
// ClassCastException) until a split face could follow its declared
// chain; the C lane agreed throughout.
interface Metadata { readonly url: string; readonly status: number; }
interface Entry extends Metadata { readonly body: object; }
class DurableEntry implements Entry { readonly url = "key"; readonly status = 17; readonly body = {}; readonly id = "id"; readonly bodyLength = 2; used = 1; }
class Store { private entries = new Map<string, DurableEntry>(); constructor() { this.entries.set("key", new DurableEntry()); } async find(url: string): Promise<readonly Entry[]> { const result: Entry[] = []; for (const entry of this.entries.values()) if (entry.url === url) result.push(entry); return result; } }
export async function result(n: number): Promise<number> { const entries = await new Store().find("key"); return entries[0].status + n; }
