import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {join} from "node:path";
import {test, type TestContext} from "node:test";
import {testScratch} from "../gate/test-scratch.ts";

function fixture(t: TestContext, eager: boolean) {
  const root = testScratch(t, "zip-codec-bindings");
  let source = stripTypeScriptTypes(readFileSync(new URL("../../runtime/node/zlib/src/zip/compression.ts", import.meta.url), "utf8"));
  for (const [from, to] of [
    ["../../../internal/errors.ts", "./errors.mjs"],
    ["../../../buffer/src/main.ts", "./buffer.mjs"],
    ["../../../stream/src/main.ts", "./stream.mjs"],
    ["./constants.ts", "./constants.mjs"],
    ["../main.ts", "./facade.mjs"],
  ] as const) source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
  if (eager) source += "\nconst eager = facadeDeflateRawSync; void eager;\n";
  writeFileSync(join(root, "compression.mjs"), source);
  writeFileSync(join(root, "errors.mjs"), ["ERR_ZIP_ENTRY_CORRUPT", "ERR_ZIP_ENTRY_TOO_LARGE", "ERR_ZIP_UNSUPPORTED_FEATURE"]
    .map(name => `export class ${name} extends Error {}`).join("\n"));
  writeFileSync(join(root, "buffer.mjs"), "export const kMaxLength = 2147483647;\n");
  writeFileSync(join(root, "stream.mjs"), "export function compose(source, transform) { void transform; return source; }\n");
  writeFileSync(join(root, "constants.mjs"), "export const FLAG_ENCRYPTED=1, METHOD_STORE=0, METHOD_DEFLATE=8, METHOD_ZSTD=93;\n");
  const asyncNames = ["deflateRaw", "inflateRaw", "zstdCompress", "zstdDecompress"];
  const streamNames = ["createDeflateRaw", "createInflateRaw", "createZstdCompress", "createZstdDecompress"];
  const syncNames = ["deflateRawSync", "inflateRawSync", "zstdCompressSync", "zstdDecompressSync"];
  writeFileSync(join(root, "facade.mjs"), `
    import assert from 'node:assert/strict';
    import * as codecs from './compression.mjs';
    export const ready = true;
    export const calls = [];
    function called(name) { assert.equal(ready, true); calls.push(name); }
    ${asyncNames.map(name => `export function ${name}(buffer, ...args) { called('${name}'); args.at(-1)(null, buffer); }`).join("\n")}
    ${streamNames.map(name => `export function ${name}() { called('${name}'); return {}; }`).join("\n")}
    ${syncNames.map(name => `export let ${name} = buffer => { called('${name}'); return buffer; };`).join("\n")}
    export function rebind(value) { deflateRawSync = () => { called('rebound'); return value; }; }
    export { codecs };
  `);
  writeFileSync(join(root, "entry.mjs"), `
    import assert from 'node:assert/strict';
    import {codecs, ready, calls, rebind} from './facade.mjs';
    assert.equal(ready, true);
    const bytes = Buffer.from([1, 2, 3]);
    for (const name of ['deflateRawSync', 'zstdCompressSync']) assert.equal(codecs[name](bytes), bytes);
    for (const name of ['deflateRawAsync', 'zstdCompressAsync']) assert.equal(await codecs[name](bytes), bytes);
    const chunks = async function* () { yield bytes; };
    for (const name of ['deflateRawStream', 'zstdCompressStream']) {
      const result = []; for await (const chunk of codecs[name](chunks())) result.push(chunk);
      assert.deepEqual(result, [bytes]);
    }
    for (const method of [8, 93]) {
      const info = {name:'entry', flags:0, method, crc32:0, uncompressedSize:3};
      assert.equal(codecs.decodeMemberSync(bytes, info, {verify:false, maxSize:16}), bytes);
      assert.equal(await codecs.decodeMemberAsync(bytes, info, {verify:false, maxSize:16}), bytes);
      const result = []; for await (const chunk of codecs.decodeMemberStream(chunks(), info, {verify:false, maxSize:16})) result.push(chunk);
      assert.deepEqual(result, [bytes]);
    }
    const rebound = Buffer.from([4]); rebind(rebound);
    assert.equal(codecs.deflateRawSync(bytes), rebound);
    assert.ok(calls.includes('rebound'));
    console.log('deferred cycle and live bindings passed');
  `);
  return spawnSync(process.execPath, [join(root, "entry.mjs")], {encoding:"utf8"});
}

test("ZIP codecs defer parent bindings through the real ESM cycle and retain live imports", t => {
  const result = fixture(t, false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /deferred cycle and live bindings passed/);
});

test("the ZIP cycle fixture rejects an eager read of the parent binding", t => {
  const result = fixture(t, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot access '.*[dD]eflateRawSync' before initialization/);
});
