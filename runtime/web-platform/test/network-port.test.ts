// Fetch section 2.9, Port blocking, snapshot 59afe349913d56898c947576216f1c2579308be7.
// https://fetch.spec.whatwg.org/commit-snapshots/59afe349913d56898c947576216f1c2579308be7/#port-blocking
import assert from "node:assert/strict";
import test from "node:test";
import { checkNetworkPort } from "../src/core/network-port.ts";

for (const port of ["4190", "6679"]) {
  test("Fetch bad-port policy blocks port " + port, { timeout: 60_000 }, () => {
    assert.throws(() => checkNetworkPort(port), TypeError);
  });
}

for (const port of ["4189", "4191", "6678", "6680"]) {
  test("Fetch bad-port policy permits neighboring port " + port, { timeout: 60_000 }, () => {
    assert.doesNotThrow(() => checkNetworkPort(port));
  });
}
