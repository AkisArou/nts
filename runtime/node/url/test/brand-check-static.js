// Reading a Web IDL attribute off the prototype throws, and nothing asserts it.
//
// Web IDL attribute getters are branded: they check that the receiver is a real
// instance and throw `TypeError` otherwise. Verified against node directly —
// `URL.prototype.href`, `URLSearchParams.prototype.size` and (for comparison)
// `util.TextDecoder.prototype.encoding` all throw when read off the prototype.
//
// **No upstream test in this profile's set checks it.** Searched
// `parallel/test-whatwg-url-*` and `test-url-*` for a prototype-receiver read:
// there is none. On a real Web IDL implementation the brand check is part of the
// generated binding and cannot be absent, so there was no invariant to test — the
// same argument as `path.posix.posix` and `querystring.decode`, and the fifth
// surface found by asking what an implementation guarantees that its tests never
// check.
//
// It matters here for a specific and cheap reason. The web-platform lane found
// that a TypeScript `private` field compiles to an ordinary property and checks
// **nothing** at run time, while a `#name` private identifier throws `TypeError`
// on a foreign receiver as a language guarantee. So the brand check is a
// *spelling*, not a hand-written guard.
//
// **This profile currently gets it right by construction, and that is the reason
// to pin it rather than a reason not to.** `url/src/url.ts` and
// `url/src/searchparams.ts` use `#` fields throughout — zero TypeScript
// `private` members between them — so every getter that reads `this.#record` or
// `this.#list` brands its receiver whether or not anyone intended it to. A later
// edit that spells one field `private` for readability, or a mechanical
// conversion, removes the brand from that attribute with **every behavioural
// test still passing**. There is no diagnostic and no failing case; the surface
// simply stops rejecting foreign receivers.
//
// So this file is a guard over a property nothing here decided to have.
//
// Asserted per attribute rather than once, because the brand lives on each
// getter: a class can be branded on `href` and unbranded on `search` if one was
// written with `#` and the next with `private`.
"use strict";

require("../common");

const assert = require("assert");
const url = require("url");

function readsOffPrototype(object, attribute) {
  try {
    void object[attribute];
    return null;
  } catch (error) {
    return error;
  }
}

for (const [name, proto, attributes] of [
  ["URL", url.URL.prototype, ["href", "protocol", "host", "pathname", "search", "hash", "origin"]],
  ["URLSearchParams", url.URLSearchParams.prototype, ["size"]],
]) {
  for (const attribute of attributes) {
    const thrown = readsOffPrototype(proto, attribute);
    assert.notStrictEqual(
      thrown,
      null,
      `${name}.prototype.${attribute} returned a value; a Web IDL attribute getter must reject a non-instance receiver`,
    );
    assert.ok(
      thrown instanceof TypeError,
      `${name}.prototype.${attribute} threw ${thrown && thrown.constructor.name}, not a TypeError`,
    );
  }
}

// And a real instance still answers, so this cannot pass by every read throwing.
{
  const instance = new url.URL("https://example.com/a?b=1#c");
  assert.strictEqual(instance.protocol, "https:", "a real URL no longer reads its protocol");
  assert.strictEqual(instance.pathname, "/a", "a real URL no longer reads its pathname");
  assert.strictEqual(
    new url.URLSearchParams("a=1&b=2").size,
    2,
    "a real URLSearchParams no longer reads its size",
  );
}
