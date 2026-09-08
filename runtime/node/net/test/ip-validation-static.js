"use strict";

// `net.isIP`, `isIPv4` and `isIPv6` on the inputs where the answer is a
// decision.
//
// **This is the whole of `net` that can be measured without a socket.** Of its
// thirty native bindings, twenty-eight have no C at all; these three are pure
// string functions and they are the part a port can get wrong quietly, because
// every wrong answer is still a plausible answer.
//
// Node validates in one C++ parser shared by all three entry points, so upstream
// `isIP` and `isIPv4` cannot disagree about the same string. Here they are three
// TypeScript functions.
//
// Thirty-five cases. The ones where "obviously" is wrong:
//
//   "01.2.3.4"      a leading zero makes it **not** an IPv4 address
//   "1.2.3.4 "      a trailing space makes it invalid; so does a leading one
//   "1.2.3.4\n"     and so does a trailing newline
//   "fe80::1%eth0"  a zone identifier is **accepted** as IPv6
//   "[::1]"         brackets are **not** accepted
//   "1.2.3.4:80"    a port is not part of an address
//   "::ffff:1.2.3.4"        an IPv4-mapped IPv6 address is IPv6, not IPv4
//   "1:2:3:4:5:6:1.2.3.4"   the mixed form is valid IPv6
//   "1::2::3"       two elisions are invalid; one is fine
//
// Plus six non-string inputs -- a number, `null`, `undefined`, `{}`, `[]` and a
// `Buffer` holding a valid address. Node answers `0`/`false` for all of them
// rather than throwing, and a `Buffer` that *contains* "1.2.3.4" is still not an
// address.
//
// Every expected value read off node v24.20.0.

const assert = require("node:assert");
const net = require("node:net");

const EXPECTED = [
  ["\"\"", "0,false,false"],
  ["\"0.0.0.0\"", "4,true,false"],
  ["\"255.255.255.255\"", "4,true,false"],
  ["\"256.0.0.1\"", "0,false,false"],
  ["\"1.2.3\"", "0,false,false"],
  ["\"1.2.3.4.5\"", "0,false,false"],
  ["\"01.2.3.4\"", "0,false,false"],
  ["\"1.2.3.04\"", "0,false,false"],
  ["\"1.2.3.4 \"", "0,false,false"],
  ["\" 1.2.3.4\"", "0,false,false"],
  ["\"1.2.3.-4\"", "0,false,false"],
  ["\"1.2.3.+4\"", "0,false,false"],
  ["\"0x1.2.3.4\"", "0,false,false"],
  ["\"1.2.3.4\\n\"", "0,false,false"],
  ["\"::\"", "6,false,true"],
  ["\"::1\"", "6,false,true"],
  ["\"fe80::1\"", "6,false,true"],
  ["\"::ffff:1.2.3.4\"", "6,false,true"],
  ["\"::ffff:256.0.0.1\"", "0,false,false"],
  ["\"1:2:3:4:5:6:7:8\"", "6,false,true"],
  ["\"1:2:3:4:5:6:7:8:9\"", "0,false,false"],
  ["\"1::2::3\"", "0,false,false"],
  ["\"fe80::1%eth0\"", "6,false,true"],
  ["\"[::1]\"", "0,false,false"],
  ["\"1.2.3.4:80\"", "0,false,false"],
  ["\"::ffff:0:0\"", "6,false,true"],
  ["\"0:0:0:0:0:0:0:0\"", "6,false,true"],
  ["\"g::1\"", "0,false,false"],
  ["\"1:2:3:4:5:6:7\"", "0,false,false"],
  ["\"1:2:3:4:5:6:1.2.3.4\"", "6,false,true"],
  ["nonstring-number", "0,false,false"],
  ["nonstring-null", "0,false,false"],
  ["nonstring-undefined", "0,false,false"],
  ["nonstring-object", "0,false,false"],
  ["nonstring-array", "0,false,false"],
  ["nonstring-buffer", "4,true,false"],
];

const rows = [];

const CASES = ["", "0.0.0.0", "255.255.255.255", "256.0.0.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "1.2.3.04", "1.2.3.4 ", " 1.2.3.4", "1.2.3.-4", "1.2.3.+4", "0x1.2.3.4", "1.2.3.4\n", "::", "::1", "fe80::1", "::ffff:1.2.3.4", "::ffff:256.0.0.1", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9", "1::2::3", "fe80::1%eth0", "[::1]", "1.2.3.4:80", "::ffff:0:0", "0:0:0:0:0:0:0:0", "g::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:1.2.3.4"];
for (const c of CASES) {
  rows.push([JSON.stringify(c), [net.isIP(c), net.isIPv4(c), net.isIPv6(c)].join(",")]);
}
// Non-string inputs: node answers 0/false rather than throwing.
for (const [label, v] of [["number", 1], ["null", null], ["undefined", undefined],
  ["object", {}], ["array", []], ["buffer", Buffer.from("1.2.3.4")]]) {
  let out;
  try { out = [net.isIP(v), net.isIPv4(v), net.isIPv6(v)].join(","); }
  catch (e) { out = "THROW:" + (e.code || e.constructor.name); }
  rows.push(["nonstring-" + label, out]);
}

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
