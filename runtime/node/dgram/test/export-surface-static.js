// `dgram`'s surface: two names published, one deliberately absent.
//
// Node exports three. `_createSocketHandle` is `cluster`'s, and `shape.mjs`
// omits it on the argument that a throwing stand-in is a worse answer than no
// property -- a test checking for it would see something that looks
// implemented. That reasoning is only worth anything if the omission cannot
// widen quietly, so this pins it: the difference from node's surface must be
// **exactly** that one name. A second omission fails here rather than being
// absorbed by a test that asserts nothing about what is missing.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:dgram")` and `require("dgram")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const dgram = require("dgram");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:dgram")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:dgram"))' +
    '.map((k) => [k, typeof require("node:dgram")[k]]))',
);

assert.ok(
  nodeKeys.includes("Socket") && nodeKeys.includes("createSocket"),
  `node's dgram exports ${nodeKeys.join(", ")}, which is not the surface this pins`,
);

const ours = new Set(Object.keys(dgram));

// The omission, named rather than tolerated.
const OMITTED = ["_createSocketHandle"];
const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  OMITTED,
  `dgram's difference from node is ${missing.join(", ") || "(none)"}, not exactly ${OMITTED.join(", ")}`,
);

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(extra, [], `dgram publishes name(s) node does not: ${extra.join(", ")}`);

for (const name of nodeKeys) {
  if (OMITTED.includes(name)) continue;
  assert.strictEqual(
    typeof dgram[name],
    nodeTypes[name],
    `dgram.${name} is ${typeof dgram[name]}, node's is ${nodeTypes[name]}`,
  );
  // Node's are ordinary declarations, so a name is guaranteed there and no
  // upstream test reads one. A compiled export aliased from a binding loses it.
  if (nodeTypes[name] === "function") {
    assert.strictEqual(
      dgram[name].name,
      name,
      `dgram.${name}.name is ${JSON.stringify(dgram[name].name)}, not ${JSON.stringify(name)}`,
    );
  }
}

// **The relationship between the two names**, which node's tests never assert
// because on node it cannot fail: `createSocket` is a factory for `Socket`, and
// two independent exports that are each the right *type* can still be
// unrelated. Node ships 40-odd dgram files and not one of them checks this.
const sock = dgram.createSocket("udp4");
try {
  assert.ok(
    sock instanceof dgram.Socket,
    "dgram.createSocket() did not return a dgram.Socket",
  );
  assert.strictEqual(Object.getPrototypeOf(sock), dgram.Socket.prototype);
} finally {
  sock.close();
}
