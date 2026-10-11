// Bounded M1a scalar census, with every emitted project accounted for.
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
const report = { cases: 0, inputDeclines: 0, wrong: [], timeouts: [], missing: [], globals: 0 };
const save = () => writeFileSync(resultFile, JSON.stringify(report, null, 2) + '\n');
const display = value => Object.is(value, -0) ? '-0' : String(value);
const call = new Script('fn(...args)');
function invoke(fn, args) {
  try { return { value: call.runInNewContext({ fn, args }, { timeout: 1000 }) }; }
  catch (error) { return { error }; }
}

try {
  const manifest = JSON.parse(readFileSync(path.join(artifact, 'program.json'), 'utf8'));
  const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
  report.phase = 'wasm-load'; save();
  const wasm = await instantiate(readFileSync(path.join(artifact, 'program.wasm')), manifest);
  report.validatedAndLinked = true; report.phase = 'node-oracle'; save();
  const js = await import(pathToFileURL(path.resolve(source)));
  const pool = [NaN, -0, 0, 1, -1, 0.5, -0.5, 2, 3, 7, 20];
  function checkGlobals() {
    for (const global of manifest.globals) {
      if (!Object.hasOwn(js, global.name)) {
        report.missing.push(global.name); continue;
      }
      if (!Object.is(wasm[global.name], js[global.name])) {
        report.wrong.push({ name: global.name, wasm: display(wasm[global.name]), js: display(js[global.name]) });
      }
      report.globals++;
    }
  }
  checkGlobals();
  for (const entry of manifest.exports) {
    if (typeof js[entry.name] !== 'function') { report.missing.push(entry.name); continue; }
    const pools = entry.params.map(param => param.ty.kind === 'bool' ? [false, true] : pool);
    // Bounded values deliberately avoid huge loop/recursion inputs. Known
    // facts still apply at the loader; record every named input refusal.
    const base = pools.map(values => values.includes(3) ? 3 : values[0]);
    const tuples = pools.length ? pools.flatMap((values, at) => values.map(value => base.with(at, value))) : [[]];
    for (const args of tuples) {
      const actual = invoke(wasm[entry.name], args);
      if (actual.error?.code === 'NTS5001') { report.inputDeclines++; continue; }
      const expected = invoke(js[entry.name], args);
      if ([actual.error, expected.error].some(error => error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')) {
        report.timeouts.push({ name: entry.name, args: args.map(display), wasm: Boolean(actual.error), js: Boolean(expected.error) });
        save(); process.exit(2);
      }
      if (actual.error || expected.error || !Object.is(actual.value, expected.value)) {
        report.wrong.push({ name: entry.name, args: args.map(display),
          wasm: actual.error ? String(actual.error) : display(actual.value),
          js: expected.error ? String(expected.error) : display(expected.value) });
      }
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
