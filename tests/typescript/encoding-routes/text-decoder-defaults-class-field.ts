/*---
description: "Default metadata is utf-8, nonfatal and BOM-aware; omitted and empty inputs produce empty strings."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this]
---*/
// TextDecoder through a class decoder field; Default metadata is utf-8, nonfatal and BOM-aware; omitted and empty inputs produce empty strings.
// Node prints: text-decoder-defaults-class-field:ok
class Reader { decoder: TextDecoder = new TextDecoder(); }
const reader = new Reader();
assert.sameValue(reader.decoder.encoding, "utf-8");
assert.sameValue(reader.decoder.fatal, false); assert.sameValue(reader.decoder.ignoreBOM, false);
assert.sameValue(reader.decoder.decode(), "");
assert.sameValue(reader.decoder.decode(Uint8Array.of()), "");
console.log("text-decoder-defaults-class-field:ok");
