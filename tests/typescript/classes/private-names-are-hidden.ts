/*---
description: A `#private` field is no property: not a key, not in JSON, not reached by element access.
features: [ts-class, ts-private-fields]
---*/
class Token {
  #secret = "s3";
  visible = "v";
  reveal(): string {
    return this.#secret;
  }
}
const token = new Token();
assert.sameValue(Object.keys(token).join(","), "visible");
assert.sameValue(JSON.stringify(token), '{"visible":"v"}');
assert.sameValue("#secret" in token, false);
assert.sameValue(token.reveal(), "s3");
