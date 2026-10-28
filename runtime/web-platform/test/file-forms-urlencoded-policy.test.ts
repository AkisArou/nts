import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { TextEncoder } from "../src/core/encoding.ts";
import { Request } from "../src/fetch/request.ts";
import { Response } from "../src/fetch/response.ts";

const encoder = new TextEncoder();
interface FormCase {
  name: string;
  input: Uint8Array;
  entries: readonly (readonly [string, string])[];
}

// Fetch passes the original bytes to the URL-encoded parser. URL section 5.1
// splits fields before percent decoding and then uses UTF-8 decode without BOM.
// https://fetch.spec.whatwg.org/#dom-body-formdata
// https://url.spec.whatwg.org/#concept-urlencoded-parser
const cases: FormCase[] = [
  { name: "keeps a literal leading BOM in a field name", input: encoder.encode("\uFEFFtest=\uFEFF"), entries: [["\uFEFFtest", "\uFEFF"]] },
  { name: "keeps percent-encoded BOMs in names and values", input: encoder.encode("%EF%BB%BFtest=%EF%BB%BF"), entries: [["\uFEFFtest", "\uFEFF"]] },
  { name: "decodes mixed raw and escaped UTF-8 bytes together", input: new Uint8Array([0xc3, 0x25, 0x41, 0x39, 0x3d, 0x25, 0x43, 0x33, 0xa9]), entries: [["é", "é"]] },
  { name: "treats an initial question mark as form data", input: encoder.encode("?a=b"), entries: [["?a", "b"]] },
  { name: "splits fields before decoding escaped delimiters", input: encoder.encode("a%26b=x%3Dy&+a=b+c&plus=%2B"), entries: [["a&b", "x=y"], [" a", "b c"], ["plus", "+"]] },
  { name: "preserves invalid percent sequences and replaces invalid UTF-8", input: new Uint8Array([0x61, 0x3d, 0x25, 0x32, 0x73, 0x25, 0x26, 0x62, 0x3d, 0xc0, 0x80]), entries: [["a", "%2s%"], ["b", "\uFFFD\uFFFD"]] },
  { name: "keeps duplicate and empty names while skipping empty fields", input: encoder.encode("&&a=1&a=2&=empty&flag&&"), entries: [["a", "1"], ["a", "2"], ["", "empty"], ["flag", ""]] },
  { name: "returns no entries for an empty body", input: new Uint8Array(0), entries: [] },
];

for (const kind of ["Request", "Response"] as const) {
  for (const item of cases) {
    test(`${kind}.formData ${item.name}`, async (t) => {
      const runtime = createHostNodeWebPlatform();
      t.after(() => runtime.close());
      const headers = { "Content-Type": "application/x-www-form-urlencoded;charset=windows-1252" };
      const body = kind === "Request"
        ? new Request("https://example.test/", { method: "POST", headers, body: item.input })
        : new Response(item.input, { headers });
      assert.deepEqual([...(await body.formData())], item.entries);
      assert.equal(body.bodyUsed, true);
      await assert.rejects(body.formData(), TypeError);
    });
  }
}
