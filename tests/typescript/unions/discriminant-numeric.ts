/*---
description: A numeric literal property discriminates a union, with an exhaustive switch.
features: [ts-unions, ts-narrowing, ts-discriminated-unions, ts-literal-types]
---*/
type Message = { version: 1; text: string } | { version: 2; parts: string[] };
function body(message: Message): string {
  switch (message.version) {
    case 1:
      return message.text;
    case 2:
      return message.parts.join(" ");
  }
}
assert.sameValue(body({ version: 1, text: "old" }), "old");
assert.sameValue(body({ version: 2, parts: ["new", "style"] }), "new style");
