import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const bytes = await readFile(path.join(artifact, 'program.wasm'));
const wasm = await instantiate(bytes, manifest);
const strings = ['', '\0', 'a', 'abc', 'é世', '😀', '\ud800', '\udfff', 'a\ud800b', 'x😀y', '�'];
const indices = [NaN, Infinity, -Infinity, -0, 0, -0.5, 0.5, -1, 1, -1.5, 1.5, 2, 3, 9, -9, 2 ** 32, -(2 ** 32), 1e100, -1e100, 2 ** 32 + 1, 2 ** 53, -(2 ** 53)];
let cases = 0;
const same = (actual, expected) => { assert.ok(Object.is(actual, expected), `${String(actual)} != ${String(expected)}`); cases++; };
for (const s of strings) {
  same(wasm.length(s), s.length); same(wasm.lengthU32(s), s.length);
  same(wasm.truthy(s), Boolean(s)); same(wasm.not(s), !s);
  for (const i of indices) {
    same(wasm.charCodeAt(s, i), s.charCodeAt(i));
    same(wasm.charCodeAtAlias(s, i), s.charCodeAt(i));
    same(wasm.charAt(s, i), s.charAt(i));
    for (const j of indices) {
      same(wasm.substring(s, i, j), s.substring(i, j));
      same(wasm.slice(s, i, j), s.slice(i, j));
    }
  }
  for (const t of strings) {
    same(wasm.eq(s, t), s === t); same(wasm.ne(s, t), s !== t);
    same(wasm.lt(s, t), s < t); same(wasm.le(s, t), s <= t);
    same(wasm.gt(s, t), s > t); same(wasm.ge(s, t), s >= t);
    same(wasm.concat(s, t), s + t);
    for (let n = 0; n <= 20; n++) same(wasm.swapStrings(s, t, n), n % 2 ? t : s);
  }
}
for (const i of [...indices, 65535, 65536, 0xd800, 0xdfff, 0x10ffff, 2 ** 52 - 1, 2 ** 84]) {
  same(wasm.fromCharCode(i), String.fromCharCode(i));
}
same(wasm.literal(), '\0é世😀�'); same(wasm.delimiter, '-'); same(wasm.count, 7);
for (const s of strings) {
  wasm.setDelimiter(s); same(wasm.delimiter, s); same(wasm.readDelimiter(), s);
  same(wasm.count, 7); same(wasm.readCount(), 7);
}
const fromCharCode = String.fromCharCode;
try {
  String.fromCharCode = () => 'tampered';
  same(wasm.fromCharCode(0xd800), fromCharCode(0xd800));
} finally { String.fromCharCode = fromCharCode; }
for (const mutate of [
  m => { m.constants[0].value = null; },
  m => { m.constants.push(structuredClone(m.constants[0])); },
  m => { m.imports.find(i => i.kind === 'global').mutable = true; },
  m => { m.constants.pop(); },
]) {
  const altered = structuredClone(manifest); mutate(altered);
  await assert.rejects(instantiate(bytes, altered), error => error instanceof TypeError || error instanceof WebAssembly.LinkError); cases++;
}
console.log(JSON.stringify({ cases, literals: manifest.constants.length, builtins: manifest.builtins.length }));
