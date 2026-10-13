// Bounded scalar/string/primitive-throw census, with emitted projects accounted for;
// an async export's promise is awaited on both sides and its settlement compared.
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
// A refusal is asked of node too: where node throws as well it is an input
// decline, and where node answers it is `refused`, tallied by its reason, so a
// refusal standing in for an answer is visible rather than counted as a throw.
const report = { cases: 0, thrownCases: 0, inputDeclines: 0, refused: {}, wrong: [], timeouts: [], missing: [], globals: 0 };
const reasonOf = error => String(error.message).replace(/^NTS5001: wasm (?:operation in|input to|result from|throw from) [^:]*: /, '');
const save = () => writeFileSync(resultFile, JSON.stringify(report, null, 2) + '\n');
const display = value => Object.is(value, -0) ? '-0' : String(value);
const call = new Script('fn(...args)');
function invoke(fn, args) {
  try { return { kind: 'return', value: call.runInNewContext({ fn, args }, { timeout: 1000 }) }; }
  catch (value) { return { kind: 'throw', value }; }
}
// An async export answers a promise on both sides: its outcome is what it
// settles with, or `pending` if it has not settled within the bound.
async function settle(outcome) {
  if (outcome.kind !== 'return' || !(outcome.value instanceof Promise)) return outcome;
  const timer = new Promise(resolve => {
    const handle = setTimeout(() => resolve({ kind: 'pending' }), 2000);
    handle?.unref?.();
  });
  return Promise.race([
    outcome.value.then(value => ({ kind: 'fulfil', value }), value => ({ kind: 'reject', value })),
    timer,
  ]);
}

try {
  const manifest = JSON.parse(readFileSync(path.join(artifact, 'program.wasm.json'), 'utf8'));
  report.phase = 'wasm-load'; save();
  let wasm, WasmInputDecline, instances;
  try {
    // Importing the generated module instantiates it and runs the module
    // initializer, as importing the source module does in node.
    await import(pathToFileURL(path.join(artifact, 'program.mjs')));
    instances = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
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
  // The instance the cases run on is made here, after every import, so its
  // timers start beside the oracle's: between now and a case only microtasks
  // run, so neither side's timers fire before the other's.
  wasm = instances.instantiate();
  checkGlobals();
  for (const entry of manifest.exports) {
    const reference = oracle(entry.name);
    if (!reference.found || typeof reference.value !== 'function') { report.missing.push(entry.name); continue; }
    const pools = entry.params.map(param => {
      switch (param.ty.kind) {
        case 'bool': return [false, true];
        case 'string': return stringPool;
        case 'int': case 'float': return pool;
        // Every primitive kind, and an object and an array, which the
        // boundary refuses by name.
        case 'value': return [undefined, null, false, true, ...pool, ...stringPool.slice(0, 4), {}, [1]];
        default: throw new Error(`unsupported census parameter type ${param.ty.kind}`);
      }
    });
    // Bounded values deliberately avoid huge loop/recursion inputs. Known
    // facts still apply at the loader; record every named input refusal.
    const base = pools.map(values => values.includes(3) ? 3 : values[0]);
    const tuples = pools.length ? pools.flatMap((values, at) => values.map(value => base.with(at, value))) : [[]];
    for (const args of tuples) {
      const actual = await settle(invoke(wasm[entry.name], args));
      if (['throw', 'reject'].includes(actual.kind) && actual.value instanceof WasmInputDecline) {
        const answered = await settle(invoke(reference.value, args));
        if (['throw', 'reject'].includes(answered.kind)) report.inputDeclines++;
        else {
          const why = reasonOf(actual.value);
          report.refused[why] = (report.refused[why] ?? 0) + 1;
        }
        save();
        continue;
      }
      const expected = await settle(invoke(reference.value, args));
      if ([actual, expected].some(outcome => outcome.kind === 'throw' && outcome.value?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')) {
        report.timeouts.push({ name: entry.name, args: args.map(display), wasm: actual.kind, js: expected.kind });
        save(); process.exit(2);
      }
      if (actual.kind !== expected.kind || !Object.is(actual.value, expected.value)) {
        report.wrong.push({ name: entry.name, args: args.map(display),
          wasmKind: actual.kind, wasm: display(actual.value),
          jsKind: expected.kind, js: display(expected.value) });
      }
      report.thrownCases += Number(expected.kind === 'throw' || expected.kind === 'reject');
      report.cases++;
      checkGlobals();
      save();
    }
  }
  save();
  // Answers only: a timer a case left pending (on either side) does not hold
  // the process past its last case.
  process.exit(report.wrong.length || report.missing.length ? 1 : 0);
} catch (error) {
  report.failure = String(error); save(); process.exitCode = 3;
}
