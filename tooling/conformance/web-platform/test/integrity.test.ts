// `integrity` was accepted on a Request and never checked. A caller who wrote
// integrity metadata got no verification and no error, which is the one failure mode
// they cannot detect. These tests cover the check and, as much as the check itself,
// that an unverifiable requirement stops the request.
//
// Host evidence for the shared algorithm and one provider's digest.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import http from "node:http";
import { createHash } from "node:crypto";

import {
  createHostNodeWebPlatform,
  hostNodeDigest,
} from "../node-runtime.ts";
import {
  digestMatches,
  parseIntegrity,
} from "../../../../runtime/web-platform/src/provider.ts";
import type { WebPlatformRuntime } from "../../../../runtime/web-platform/src/provider.ts";
import type { WebPlatformOptions } from "../../../../runtime/web-platform/src/provider.ts";
import { causeText } from "./harness.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const BODY = "integrity subject";

function base64(algorithm: string, text: string): string {
  return createHash(algorithm).update(text).digest("base64");
}

async function origin(t: TestContext, body: string = BODY): Promise<string> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  // `address()` is a union with a pipe path and `null`; a TCP listener that has emitted
  // `listening` is always the object form, and narrowing says so rather than assuming it.
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "a listening TCP server has an address");
  return `http://127.0.0.1:${address.port}/`;
}

function runtimeWith(t: TestContext, digest: WebPlatformOptions["digest"]): WebPlatformRuntime {
  const api = createHostNodeWebPlatform({ digest });
  t.after(() => api.close());
  return api;
}

// A separate helper rather than `runtimeWith(t, undefined)`: passing `undefined`
// explicitly triggers a default parameter, so that spelling built a runtime that did
// have a provider and the fail-closed assertions passed for the wrong reason.
function runtimeWithoutDigest(t: TestContext): WebPlatformRuntime {
  const api = createHostNodeWebPlatform({});
  t.after(() => api.close());
  assert.equal(api.requestContext.digest, undefined, "this runtime must have no provider");
  return api;
}

function because(pattern: RegExp): (error: unknown) => boolean {
  return (error) => {
    assert.match(causeText(error), pattern);
    return true;
  };
}

suite("integrity metadata parses to the strongest algorithm present", () => {
  assert.deepEqual(parseIntegrity(""), []);
  assert.deepEqual(parseIntegrity("   "), []);
  // Unknown algorithms are dropped rather than failing otherwise-valid metadata.
  assert.deepEqual(parseIntegrity("md5-abc"), []);
  assert.deepEqual(parseIntegrity("sha256-AAA"), [{ algorithm: "sha256", digest: "AAA" }]);
  // A stronger entry present is the one that applies, and weaker ones drop out.
  assert.deepEqual(parseIntegrity("sha256-AAA sha512-BBB"), [
    { algorithm: "sha512", digest: "BBB" },
  ]);
  // Several entries of the strongest algorithm all remain; any match is a match.
  assert.deepEqual(parseIntegrity("sha384-AAA sha384-BBB sha256-CCC"), [
    { algorithm: "sha384", digest: "AAA" },
    { algorithm: "sha384", digest: "BBB" },
  ]);
  // Options after `?` carry no defined meaning and must not cause a failure.
  assert.deepEqual(parseIntegrity("sha256-AAA?ct=text/plain"), [
    { algorithm: "sha256", digest: "AAA" },
  ]);
  assert.deepEqual(parseIntegrity("SHA256-AAA"), [{ algorithm: "sha256", digest: "AAA" }]);
  assert.deepEqual(parseIntegrity("sha256-"), []);
  assert.deepEqual(parseIntegrity("notanentry"), []);
});

suite("a digest matches across padding and both base64 alphabets", () => {
  const bytes = new Uint8Array(createHash("sha256").update(BODY).digest());
  const standard = base64("sha256", BODY);
  assert.equal(digestMatches(bytes, parseIntegrity("sha256-" + standard)), true);
  // base64url spelling of the same digest.
  const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
  assert.equal(digestMatches(bytes, parseIntegrity("sha256-" + urlSafe)), true);
  // Unpadded spelling of the same digest.
  assert.equal(digestMatches(bytes, parseIntegrity("sha256-" + standard.replace(/=+$/, ""))), true);
  // A digest of the right length that is simply wrong.
  assert.equal(digestMatches(bytes, parseIntegrity("sha256-" + base64("sha256", "other"))), false);
  // Any entry matching is enough.
  const several = parseIntegrity(`sha256-${base64("sha256", "other")} sha256-${standard}`);
  assert.equal(digestMatches(bytes, several), true);
  assert.equal(digestMatches(bytes, parseIntegrity("sha256-!!!not-base64!!!")), false);
});

suite("a matching response is returned and its bytes are the verified ones", async (t) => {
  const url = await origin(t);
  const api = runtimeWith(t, hostNodeDigest);
  const response = await api.fetch(url, { integrity: "sha256-" + base64("sha256", BODY) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), BODY);
});

suite("every supported algorithm verifies", async (t) => {
  const url = await origin(t);
  const api = runtimeWith(t, hostNodeDigest);
  for (const algorithm of ["sha256", "sha384", "sha512"]) {
    const response = await api.fetch(url, {
      integrity: `${algorithm}-${base64(algorithm, BODY)}`,
    });
    assert.equal(await response.text(), BODY);
  }
});

suite("a mismatching response is a network error and its body is never delivered", async (t) => {
  const url = await origin(t);
  const api = runtimeWith(t, hostNodeDigest);
  await assert.rejects(
    api.fetch(url, { integrity: "sha256-" + base64("sha256", "a different body") }),
    because(/did not match the requested integrity/),
  );
});

suite("the strongest algorithm is the one enforced", async (t) => {
  const url = await origin(t);
  const api = runtimeWith(t, hostNodeDigest);
  // A correct sha256 alongside a wrong sha512 must fail: the sha512 entry is the one
  // that applies, and a weaker correct entry does not rescue it.
  await assert.rejects(
    api.fetch(url, {
      integrity: `sha256-${base64("sha256", BODY)} sha512-${base64("sha512", "wrong")}`,
    }),
    because(/did not match the requested integrity/),
  );
  // The reverse ordering behaves the same, so this is about strength and not position.
  await assert.rejects(
    api.fetch(url, {
      integrity: `sha512-${base64("sha512", "wrong")} sha256-${base64("sha256", BODY)}`,
    }),
    because(/did not match the requested integrity/),
  );
});

suite("metadata naming only unknown algorithms places no requirement", async (t) => {
  const url = await origin(t);
  const api = runtimeWith(t, hostNodeDigest);
  const response = await api.fetch(url, { integrity: "md5-" + base64("sha256", "anything") });
  assert.equal(await response.text(), BODY);
});

suite("a check that cannot be performed stops the request", async (t) => {
  const url = await origin(t);
  // No digest provider at all.
  const none = runtimeWithoutDigest(t);
  await assert.rejects(
    none.fetch(url, { integrity: "sha256-" + base64("sha256", BODY) }),
    because(/cannot verify it/),
  );
  // A provider that does not offer the requested algorithm.
  const partial = runtimeWith(t, {
    algorithms: ["sha256"],
    digest: hostNodeDigest.digest.bind(hostNodeDigest),
  });
  await assert.rejects(
    partial.fetch(url, { integrity: "sha512-" + base64("sha512", BODY) }),
    because(/algorithm is not available: sha512/),
  );
  // And the same environment still serves a request it can verify.
  const ok = await partial.fetch(url, { integrity: "sha256-" + base64("sha256", BODY) });
  assert.equal(await ok.text(), BODY);
});

suite("a request without integrity is unaffected by the absence of a provider", async (t) => {
  const url = await origin(t);
  const api = runtimeWithoutDigest(t);
  assert.equal(await (await api.fetch(url)).text(), BODY);
});

// A digest is a base64 value, and until this was checked at parse time a digest holding
// any code unit above U+00FF reached `encodeByteString` at *match* time and threw
// `TypeError: Expected an HTTP ByteString`. `integrity` is a DOMString a script sets, so
// `new Request(url, { integrity: "sha256-\u0100" })` turned an integrity check into an
// exception thrown from a layer below the one the caller was addressing.
//
// Found by the NodeJS lane reporting three bugs of exactly this shape in their own
// base64 and hex -- decoding a string's characters where node decodes its bytes. This
// codebase does not have their bug, because `encodeByteString` refuses rather than
// masking; it had the other half of it, where the refusal escaped as the wrong error.
test("a digest that is not a base64 value is discarded, not thrown over", () => {
  for (const metadata of [
    "sha256-\u0100",
    "sha256-\u{1F600}",
    "sha256-!!!!",
    "sha384-\u00ff\u0100",
  ]) {
    assert.deepEqual(parseIntegrity(metadata), [], metadata);
  }
});

test("the base64url alphabet and padding are digests, not junk", () => {
  // `-` and `_` are the URL alphabet's substitutes for `+` and `/`, and the match path
  // converts them; rejecting them here would break every caller using that spelling.
  const entries = parseIntegrity("sha256-YWJj-ZGVm_Z2hp=");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.digest, "YWJj-ZGVm_Z2hp=");
});

test("metadata that parses to nothing means no check, not a check that fails", () => {
  // Worth asserting rather than assuming, because it is the security-relevant half of
  // discarding invalid entries: this is the Subresource Integrity behaviour, and a
  // caller wanting "invalid metadata must fail" has to validate before setting it.
  assert.deepEqual(parseIntegrity("sha256-!!!!"), []);
  assert.deepEqual(parseIntegrity("md5-abcd"), [], "an unsupported algorithm, the same way");
  assert.deepEqual(parseIntegrity("nonsense"), []);
});
