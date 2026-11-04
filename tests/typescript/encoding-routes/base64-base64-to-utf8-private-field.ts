/*---
description: "atob binary code units become the exact byte sequence decoded as UTF-8, preserving supplementary and replacement units."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-private-fields, ts-readonly, ts-arrow-functions, ts-iteration]
---*/
// atob and a retained private TextDecoder field; atob binary code units become the exact byte sequence decoded as UTF-8, preserving supplementary and replacement units.
// Node prints: base64-base64-to-utf8-private-field:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }
class Reader {
  #decoder: TextDecoder = new TextDecoder();
  decode(input: string, expected: readonly number[]): string {
    const binary = atob(input), bytes = Uint8Array.from(binary, (unit) => unit.charCodeAt(0));
    assert.compareArray(Array.from(bytes), expected);
    return this.#decoder.decode(bytes);
  }
}
const reader = new Reader();
assert.compareArray(units(reader.decode("w6nwn5iA", [0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80])), [0xe9, 0xd83d, 0xde00]);
assert.compareArray(units(reader.decode("4oKs", [0xe2, 0x82, 0xac])), [0x20ac]);
assert.compareArray(units(reader.decode("77+9", [0xef, 0xbf, 0xbd])), [0xfffd]);
assert.compareArray(units(reader.decode("", [])), []);
console.log("base64-base64-to-utf8-private-field:ok");
