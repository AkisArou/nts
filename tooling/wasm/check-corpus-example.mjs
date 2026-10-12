// Bounded scalar/string/primitive-throw census, with emitted projects accounted for.
// This answers-only population does not replace the full M1 agree instrument.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import path from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const sibling = new URL(specifier, context.parentURL);
      sibling.pathname = sibling.pathname.slice(0, -3) + '.ts';
      if (existsSync(fileURLToPath(sibling))) {
        return { url: sibling.href, format: 'module-typescript', shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const [artifact, source, resultFile] = process.argv.slice(2);
const report = { cases: 0, thrownCases: 0, inputDeclines: 0, wrong: [], timeouts: [], missing: [], globals: 0 };
const save = () => writeFileSync(resultFile, JSON.stringify(report, null, 2) + '\n');
const display = value => Object.is(value, -0) ? '-0' : String(value);
const call = new Script('fn(...args)');
function invoke(fn, args) {
  try { return { kind: 'return', value: call.runInNewContext({ fn, args }, { timeout: 1000 }) }; }
  catch (value) { return { kind: 'throw', value }; }
}

try {
  const manifest = JSON.parse(readFileSync(path.join(artifact, 'program.wasm.json'), 'utf8'));
  report.phase = 'wasm-load'; save();
  let wasm, WasmInputDecline;
  try {
    // Importing the generated module instantiates it and runs the module
    // initializer, as importing the source module does in node.
    await import(pathToFileURL(path.join(artifact, 'program.mjs')));
    const instances = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
    WasmInputDecline = instances.WasmInputDecline;
    wasm = instances.instantiate();
  } catch (value) {
    if (value instanceof WebAssembly.CompileError || value instanceof WebAssembly.LinkError || value instanceof WebAssembly.RuntimeError) throw value;
    report.phase = 'module-initialization';
    // A failed import exposes no class to test against; a named refusal is a
    // TypeError carrying the NTS5001 code.
    if (value instanceof TypeError && value.code === 'NTS5001') {
      report.moduleInitDecline = display(value); save(); process.exit(0);
    }
    let expected;
    try { await import(pathToFileURL(path.resolve(source))); expected = { kind: 'return' }; }
    catch (value) { expected = { kind: 'throw', value }; }
    if (expected.kind !== 'throw' || !Object.is(value, expected.value)) {
      report.wrong.push({ name: '<module initialization>', wasmKind: 'throw', wasm: display(value), jsKind: expected.kind, js: display(expected.value) });
    } else {
      report.validatedAndLinked = true; report.cases++; report.thrownCases++;
    }
    save(); process.exit(report.wrong.length ? 1 : 0);
  }
  report.validatedAndLinked = true; report.phase = 'node-oracle'; save();
  const js = await import(pathToFileURL(path.resolve(source)));
  // Every public definition may come from a different included source file.
  // Use the compiler's Origins to locate those oracle modules, requiring an
  // unambiguous exported name rather than guessing a similarly named function.
  const namespaces = [js];
  const missing = [...manifest.exports, ...manifest.globals].some(entry => !Object.hasOwn(js, entry.name));
  if (missing) {
    const origins = JSON.parse(readFileSync(path.join(artifact, 'program.origins.json'), 'utf8'));
    for (const entry of origins.sources) {
      if (!entry.uri.startsWith('nts-workspace:///')) continue;
      const file = path.resolve(path.dirname(source), '..', decodeURIComponent(new URL(entry.uri).pathname).slice(1));
      if (file === path.resolve(source) || !existsSync(file) || !/\.(ts|tsx|js|mjs)$/.test(file)) continue;
      namespaces.push(await import(pathToFileURL(file)));
    }
  }
  function oracle(name) {
    const owners = namespaces.filter(namespace => Object.hasOwn(namespace, name));
    if (owners.length !== 1) return { found: false };
    return { found: true, value: owners[0][name] };
  }
  const pool = [NaN, -0, 0, 1, -1, 0.5, -0.5, 2, 3, 7, 20];
  const stringPool = ['', 'a', 'abc', '3', '-1', '0.5', 'hello world', 'a\0b', 'é', '😀', '\ud800', '\udfff', 'a\ud800b'];
  function checkGlobals() {
    for (const global of manifest.globals) {
      const expected = oracle(global.name);
      if (!expected.found) {
        report.missing.push(global.name); continue;
      }
      if (!Object.is(wasm[global.name], expected.value)) {
        report.wrong.push({ name: global.name, wasm: display(wasm[global.name]), js: display(expected.value) });
      }
      report.globals++;
    }
  }
  checkGlobals();
  for (const entry of manifest.exports) {
    const reference = oracle(entry.name);
    if (!reference.found || typeof reference.value !== 'function') { report.missing.push(entry.name); continue; }
    const pools = entry.params.map(param => {
      switch (param.ty.kind) {
        case 'bool': return [false, true];
        case 'string': return stringPool;
        case 'int': case 'float': return pool;
        default: throw new Error(`unsupported census parameter type ${param.ty.kind}`);
      }
    });
    // Bounded values deliberately avoid huge loop/recursion inputs. Known
    // facts still apply at the loader; record every named input refusal.
    const base = pools.map(values => values.includes(3) ? 3 : values[0]);
    const tuples = pools.length ? pools.flatMap((values, at) => values.map(value => base.with(at, value))) : [[]];
    for (const args of tuples) {
      const actual = invoke(wasm[entry.name], args);
      if (actual.kind === 'throw' && actual.value instanceof WasmInputDecline) { report.inputDeclines++; continue; }
      const expected = invoke(reference.value, args);
      if ([actual, expected].some(outcome => outcome.kind === 'throw' && outcome.value?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')) {
        report.timeouts.push({ name: entry.name, args: args.map(display), wasm: actual.kind, js: expected.kind });
        save(); process.exit(2);
      }
      if (actual.kind !== expected.kind || !Object.is(actual.value, expected.value)) {
        report.wrong.push({ name: entry.name, args: args.map(display),
          wasmKind: actual.kind, wasm: display(actual.value),
          jsKind: expected.kind, js: display(expected.value) });
      }
      report.thrownCases += Number(expected.kind === 'throw');
      report.cases++;
      checkGlobals();
      save();
    }
  }
  save();
  process.exitCode = report.wrong.length || report.missing.length ? 1 : 0;
} catch (error) {
  report.failure = String(error); save(); process.exitCode = 3;
}
