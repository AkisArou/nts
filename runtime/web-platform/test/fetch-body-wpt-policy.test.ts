// Source-policy controls for Fetch cases not covered by the unchanged WPT files.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Request, Response } from "../src/index.ts";

const runtime = createHostNodeWebPlatform();
after(() => runtime.close());

interface BodySurface {
  readonly bodyUsed: boolean;
  bytes(): Promise<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  blob(): Promise<{ text(): Promise<string> }>;
  formData(): Promise<{ get(name: string): unknown }>;
}

const bodyFactories = [
  {
    name: "Response",
    create: (body: string, contentType: string): BodySurface =>
      new Response(body, { headers: { "content-type": contentType } }),
    oracle: (body: string, contentType: string): BodySurface =>
      new globalThis.Response(body, { headers: { "content-type": contentType } }),
  },
  {
    name: "Request",
    create: (body: string, contentType: string): BodySurface =>
      new Request("https://example.test/", { method: "POST", body, headers: { "content-type": contentType } }),
    oracle: (body: string, contentType: string): BodySurface =>
      new globalThis.Request("https://example.test/", { method: "POST", body, headers: { "content-type": contentType } }),
  },
];

// https://fetch.spec.whatwg.org/#concept-body-consume-body
// Body methods each consume the associated body, without calling sibling methods.
for (const factory of bodyFactories) {
  for (const fixture of [
    { method: "text", read: (body: BodySurface): Promise<unknown> => body.text() },
    { method: "arrayBuffer", read: async (body: BodySurface): Promise<unknown> =>
      Array.from(new Uint8Array(await body.arrayBuffer())) },
    { method: "blob", read: async (body: BodySurface): Promise<unknown> => (await body.blob()).text() },
    { method: "formData", read: async (body: BodySurface): Promise<unknown> => (await body.formData()).get("a") },
  ]) {
    test(`${factory.name}.${fixture.method} consumes its own body despite a shadowed bytes method`, async () => {
      const subject = factory.create("a=1", "application/x-www-form-urlencoded");
      const oracle = factory.oracle("a=1", "application/x-www-form-urlencoded");
      let calls = 0;
      const replacement = (): Promise<Uint8Array> => {
        calls++;
        return Promise.reject(new Error("public bytes method was invoked"));
      };
      subject.bytes = replacement;
      oracle.bytes = replacement;
      assert.deepEqual(await fixture.read(subject), await fixture.read(oracle));
      assert.equal(calls, 0);
      assert.equal(subject.bodyUsed, true);
      await assert.rejects(fixture.read(subject), TypeError);
      assert.equal(calls, 0);
    });
  }

  test(`${factory.name}.json consumes its own body despite shadowed text and bytes methods`, async () => {
    const subject = factory.create("7", "application/json");
    const oracle = factory.oracle("7", "application/json");
    let calls = 0;
    const replacement = (): never => {
      calls++;
      throw new Error("public body method was invoked");
    };
    subject.text = oracle.text = replacement;
    subject.bytes = oracle.bytes = replacement;
    assert.equal(await subject.json(), await oracle.json());
    assert.equal(calls, 0);
    assert.equal(subject.bodyUsed, true);
    await assert.rejects(subject.json(), TypeError);
    assert.equal(calls, 0);
  });
}
