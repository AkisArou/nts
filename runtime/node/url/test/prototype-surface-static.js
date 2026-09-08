// Every name node has on these prototypes is still on ours.
//
// **This is the direction an export diff does not check.** `sweep.mjs` audits
// names that are *absent from the shape* — what the module fails to export. It
// has never once asked whether a name that should be on a **prototype** still
// is. Those are different surfaces: a class can be exported, constructed,
// `instanceof`-correct and answer every value correctly while a method has
// quietly moved off its prototype.
//
// The web-platform lane hit exactly this from the other side today. Their suite
// checked that no *extra* names appear on a cleared prototype and never that
// every standard name is still there — and symbol-keying a public member is
// invisible to `getOwnPropertyNames` in precisely the direction they were not
// checking. Writing the missing direction failed immediately and found two
// interfaces they had twice reported as fully conformant.
//
// Node's own tests cannot cover this for the same reason they cannot cover the
// brand checks: on a real Web IDL implementation the prototype is generated, so
// a member cannot go missing. Searched `parallel/test-whatwg-url-*` for a
// `getOwnPropertyNames` against either prototype — there is none.
//
// **One direction only, deliberately.** This asserts that node's names are all
// present, not that ours are exactly node's. An implementation may carry extra
// own members for reasons that are not deviations, and asserting equality would
// turn every such choice into a failure here rather than a decision where it
// belongs. What must never happen silently is a name node has going missing.
"use strict";

require("../common");

const assert = require("assert");
const url = require("url");

// Read off node's own classes rather than listed by hand, so this tracks the
// running node rather than the one it was written against.
const upstream = {
  URL: [URL.prototype, url.URL.prototype],
  URLSearchParams: [URLSearchParams.prototype, url.URLSearchParams.prototype],
};

for (const [name, [nodeProto, ourProto]] of Object.entries(upstream)) {
  const expected = Object.getOwnPropertyNames(nodeProto).sort();
  const actual = new Set(Object.getOwnPropertyNames(ourProto));
  const missing = expected.filter((member) => !actual.has(member));

  assert.ok(expected.length > 5, `${name}: node's prototype looks empty, so this checked nothing`);
  assert.deepStrictEqual(
    missing,
    [],
    `${name}.prototype is missing member(s) node has: ${missing.join(", ")}`,
  );
}

// And the members are reachable through an instance, so this cannot pass on a
// prototype carrying names that do not work.
{
  const u = new url.URL("https://user:pw@example.com:8080/a/b?c=1#d");
  assert.strictEqual(u.hostname, "example.com", "hostname does not read");
  assert.strictEqual(u.port, "8080", "port does not read");
  assert.strictEqual(u.username, "user", "username does not read");
  assert.strictEqual(typeof u.toJSON(), "string", "toJSON does not answer a string");

  const p = new url.URLSearchParams("a=1&a=2&b=3");
  assert.deepStrictEqual(p.getAll("a"), ["1", "2"], "getAll does not answer both values");
  assert.strictEqual(p.has("b"), true, "has does not find b");
}
