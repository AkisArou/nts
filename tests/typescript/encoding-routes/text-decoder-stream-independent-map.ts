/*---
description: "Two interleaved decoders preserve separate partial UTF-8 characters when read back from a Map."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-map-set, ts-narrowing, ts-null-undefined, ts-objects]
---*/
// TextDecoder through Map.get with undefined narrowing; Two interleaved decoders preserve separate partial UTF-8 characters when read back from a Map.
// Node prints: text-decoder-stream-independent-map:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

const readers = new Map<string, TextDecoder>();
readers.set("euro", new TextDecoder()); readers.set("face", new TextDecoder());
function reader(key: string): TextDecoder { const value = readers.get(key); if (value === undefined) throw new Error("missing decoder"); return value; }
assert.sameValue(reader("euro").decode(Uint8Array.of(0xe2, 0x82), { stream: true }), "");
assert.sameValue(reader("face").decode(Uint8Array.of(0xf0, 0x9f, 0x98), { stream: true }), "");
assert.sameValue(reader("euro").decode(Uint8Array.of(0xac)), "€");
assert.compareArray(units(reader("face").decode(Uint8Array.of(0x80))), [0xd83d, 0xde00]);
console.log("text-decoder-stream-independent-map:ok");
