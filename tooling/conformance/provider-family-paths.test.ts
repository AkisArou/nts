import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonParse, jsonStringify } from "../../runtime/ecmascript/src/json/json.ts";
import { parsePlainText } from "../../runtime/ecmascript/src/json/plain.ts";
import { JsonValue } from "../../runtime/ecmascript/src/json/value.ts";
import { jsonParse as facadeParse } from "../../runtime/web-platform/src/json/json.ts";
import { JsonValue as FacadeValue } from "../../runtime/web-platform/src/json/value.ts";

test("the canonical ECMAScript JSON entry points retain their results", () => {
  const text = '{"a":[1,true,null],"b":"value"}';
  const parsed = jsonParse(text);
  assert.ok(parsed);
  assert.equal(jsonStringify(parsed), JSON.stringify(JSON.parse(text)));
  assert.deepEqual(parsePlainText(text), JSON.parse(text));
});

test("the temporary JSON facades preserve the canonical identities", () => {
  assert.equal(facadeParse, jsonParse);
  assert.equal(FacadeValue, JsonValue);
  assert.ok(FacadeValue.numberValue(3, 0, 0) instanceof JsonValue);
});
