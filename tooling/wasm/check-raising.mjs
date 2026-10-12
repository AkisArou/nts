import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const bytes = await readFile(path.join(artifact, 'program.wasm'));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
let cases = 0;
function caught(fn) { try { return { raised: false, value: fn() }; } catch (value) { return { raised: true, value }; } }
function throwsValue(fn, value) { const answer = caught(fn); assert.equal(answer.raised, true); assert.ok(Object.is(answer.value, value), `${String(answer.value)} != ${String(value)}`); cases++; }
const instantiateNative = WebAssembly.instantiate;
let instance;
try {
  WebAssembly.instantiate = async (...args) => {
    const answer = await instantiateNative(...args);
    if (args[0] instanceof WebAssembly.Module && WebAssembly.Module.exports(args[0]).some(e => e.name === manifest.activation.enter)) instance = answer;
    return answer;
  };
  if (manifest.init !== null) {
    const result = await instantiate(bytes, manifest).then(() => ({ raised: false }), value => ({ raised: true, value }));
    assert.equal(result.raised, true); assert.equal(result.value, 'init payload');
    assert.equal(instance.exports[manifest.activation.raising](), 0);
    instance.exports[manifest.activation.enter]();
    assert.equal(instance.exports.pending(), 0);
    instance.exports[manifest.activation.leave]();
    console.log(JSON.stringify({ cases: 3, init_cleanup: true }));
  } else {
    const wasm = await instantiate(bytes, manifest);
    const first = instance;
    const other = await instantiate(bytes, manifest);
    const second = instance;
    const a = manifest.activation;
    const raw = first.exports;
    assert.ok(!Object.keys(wasm).some(name => name.startsWith('$nts$activation$')));
    for (const prefix of ['raise', 'uncaught']) {
      for (const value of [NaN, Infinity, -Infinity, -0, 0, 1, -1, .5, 1073741823, 1073741824, -1073741824, -1073741825, Number.MIN_VALUE, Number.MAX_VALUE]) {
        throwsValue(() => wasm[`${prefix}Number`](value), value);
        assert.equal(wasm.pending(), 0); cases++;
      }
      for (const value of [false, true]) { throwsValue(() => wasm[`${prefix}Boolean`](value), value); assert.equal(wasm.pending(), 0); cases++; }
      for (const value of ['', 'abc', '\0', '😀', '\ud800', '\udfff', 'a\ud800b']) { throwsValue(() => wasm[`${prefix}String`](value), value); assert.equal(wasm.pending(), 0); cases++; }
      throwsValue(() => wasm[`${prefix}Undefined`](), undefined);
      throwsValue(() => wasm[`${prefix}Null`](), null);
    }
    for (let n = 0; n < 32; n++) { assert.equal(wasm.caughtObject(), true); assert.equal(wasm.pending(), 0); cases += 2; }
    assert.throws(() => wasm.uncaughtObject(), e => e instanceof WasmInputDecline && String(e).includes('uncaughtObject') && String(e).includes('identity bridge')); cases++;
    assert.throws(() => wasm.refusal(23), e => e instanceof WasmInputDecline && String(e).includes('refusal')); cases++;
    assert.equal(wasm.pending(), 0); cases++;
    assert.throws(() => wasm.raiseNumber('wrong'), e => e instanceof WasmInputDecline); cases++;
    assert.equal(wasm.pending(), 0); cases++;
    // Enclosing state survives repeated nested public calls and nested raises.
    raw[a.enter](); raw.raiseString('enclosing payload');
    assert.equal(raw[a.raising](), 1);
    assert.equal(wasm.pending(), 0);
    assert.equal(other.pending(), 0);
    assert.equal(second.exports[a.raising](), 0);
    throwsValue(() => wasm.uncaughtNumber(17), 17);
    assert.equal(raw[a.raising](), 1);
    throwsValue(() => raw[a.publish]('outer'), 'enclosing payload');
    assert.throws(() => wasm.refusal(9), e => e instanceof WasmInputDecline);
    assert.equal(raw[a.raising](), 1);
    throwsValue(() => raw[a.publish]('outer'), 'enclosing payload');
    raw[a.leave](); assert.equal(raw[a.raising](), 0); cases += 9;
    // A real Wasm -> host -> Wasm re-entry, followed by an unrelated host throw.
    const token = Object.freeze({ host: 'exception' });
    let callbackInstance, callbackNamespace, reentered = false;
    WebAssembly.instantiate = async (module, imports) => {
      if (module instanceof WebAssembly.Module && WebAssembly.Module.exports(module).some(e => e.name === a.enter)) {
        imports['nts:host/v1'].inputDecline = () => {
          assert.equal(callbackInstance.exports[a.raising](), 1);
          throwsValue(() => callbackNamespace.uncaughtString('inner payload'), 'inner payload');
          assert.equal(callbackNamespace.pending(), 0);
          throwsValue(() => callbackInstance.exports[a.publish]('host callback'), 37);
          reentered = true;
          throw token;
        };
        callbackInstance = await instantiateNative(module, imports); return callbackInstance;
      }
      return instantiateNative(module, imports);
    };
    callbackNamespace = await instantiate(bytes, manifest);
    throwsValue(() => callbackNamespace.refusal(37), token);
    assert.ok(reentered);
    assert.equal(callbackInstance.exports[a.raising](), 0);
    assert.equal(callbackNamespace.pending(), 0); cases += 3;
    for (const mutate of [m => { delete m.activation.leave; }, m => { m.activation.enter = 'pending'; }, m => { delete m.activation; }, m => { m.exports[0].name = a.enter; }]) {
      const altered = structuredClone(manifest); mutate(altered);
      await assert.rejects(instantiate(bytes, altered), WebAssembly.LinkError); cases++;
    }
    console.log(JSON.stringify({ cases, nested_reentry: true, host_exception_cleanup: true, cold_refusal_cleanup: true, instance_isolation: true }));
  }
} finally { WebAssembly.instantiate = instantiateNative; }
