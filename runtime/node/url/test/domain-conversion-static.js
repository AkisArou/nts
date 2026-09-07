// `domainToASCII` and `domainToUnicode` parse a *host*, not a string.
//
// These look like the IDNA mapping and are not. Node parses the argument as
// the host of a special-scheme URL and serialises the result, so they inherit
// IPv4 shorthand, IPv6 canonicalisation, delimiter handling and the forbidden
// domain code points. Before this was understood, the implementation applied
// the mapping to the whole argument and returned it unchanged when it could
// not convert it, so `domainToASCII("http://a")` was `"http://a"` where node
// gives `""`.
//
// A differential against node over 4,000 generated URLs found it: 8,046
// divergences. Nothing in the 45 pinned `url` files covers any of it, and the
// 891-case WPT corpus this profile passes does not either, because both test
// URLs rather than this pair of functions.
"use strict";

require("../common");

const assert = require("assert");
const url = require("url");

for (const [input, expected] of [
  // Not a domain at all.
  ["http://a", ""],
  ["///", ""],
  ["a:80", ""],       // `:` is forbidden in a domain and is not a delimiter
  ["a@b", ""],        // nor is `@`
  ["a%2Fb", ""],      // nor `%`
  ["a b", ""],
  ["", ""],
  // Everything from the first delimiter on is not part of the domain.
  ["1.2.3.4//x#f", "1.2.3.4"],
  ["a/b", "a"],
  ["a?q", "a"],
  ["a#f", "a"],
  ["a\\b", "a"],
  ["ü/日", "xn--tda"],
  // IPv4, in each of its historical spellings.
  ["0x7f.1", "127.0.0.1"],
  ["2130706433", "127.0.0.1"],
  ["1.2.3.4", "1.2.3.4"],
  ["999.999.999.999", ""],
  ["1.2.3.4.5", ""],
  // IPv6, canonicalised.
  ["[::1]", "[::1]"],
  ["[::FFFF:1.2.3.4]", "[::ffff:102:304]"],
  ["[::1", ""],
  ["[zzz]", ""],
  // The mapping itself still applies to an actual domain.
  ["ü.com", "xn--tda.com"],
  ["A.COM", "a.com"],
  ["Ａ.com", "a.com"],
]) {
  assert.strictEqual(url.domainToASCII(input), expected, `domainToASCII(${JSON.stringify(input)})`);
}

for (const [input, expected] of [
  ["xn--tda.com", "ü.com"],
  ["ü.com", "ü.com"],
  ["A.COM", "a.com"],
  ["0x7f.1", "127.0.0.1"],
  ["[::1]", "[::1]"],
  ["http://a", ""],
  ["a:80", ""],
]) {
  assert.strictEqual(url.domainToUnicode(input), expected, `domainToUnicode(${JSON.stringify(input)})`);
}

// The guard on the split between the public function and the parser's own host
// conversion. A domain that percent-decodes to something containing `/` is a
// parse *failure* per the URL Standard; the public function truncates at a `/`
// instead. Routing the parser through the public one would turn this failure
// into the host `a`.
assert.throws(() => new URL("http://a%2Fb/"), { code: "ERR_INVALID_URL" });
assert.strictEqual(url.domainToASCII("a%2Fb"), "");
