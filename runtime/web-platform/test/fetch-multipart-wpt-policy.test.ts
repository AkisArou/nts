import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "../src/core/encoding.ts";
import { decodeMultipart } from "../src/forms/multipart-decode.ts";
import { parseMIMEType } from "../src/forms/mime.ts";

const mime = parseMIMEType("multipart/form-data; boundary=b");
assert.ok(mime);
const encoder = new TextEncoder();

// RFC 2046 section 5.1.1 permits SP/HTAB transport padding after both kinds of
// delimiter. Fetch formData() uses the multipart parser, including this syntax.
test("multipart accepts transport padding on opening, intermediate and closing boundaries", () => {
  const body = '--b \t\r\nContent-Disposition: form-data; name="first"\r\n\r\none' +
    '\r\n--b\t \r\nContent-Disposition: form-data; name="second"\r\n\r\ntwo' +
    '\r\n--b--\t \r\nepilogue';
  assert.deepEqual([...decodeMultipart(encoder.encode(body), mime)], [["first", "one"], ["second", "two"]]);
});

test("multipart preserves a padded boundary prefix followed by payload bytes", () => {
  const payload = "before\r\n--b \tX\r\nafter";
  const body = '--b\r\nContent-Disposition: form-data; name="value"\r\n\r\n' + payload + '\r\n--b--';
  assert.equal(decodeMultipart(encoder.encode(body), mime).get("value"), payload);
});

test("multipart does not accept arbitrary bytes after closing-boundary padding", () => {
  const body = '--b\r\nContent-Disposition: form-data; name="value"\r\n\r\nx\r\n--b-- \tX';
  assert.throws(() => decodeMultipart(encoder.encode(body), mime), TypeError);
});
