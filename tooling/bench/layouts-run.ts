// Reusable native layout mode: explicit immutable link inputs, all seeded
// layouts, matched work, A/B/A repeats, and a decision on arm means.
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {linkLayouts} from './layouts-link.ts';
import {experiment, linkPlan} from './layouts-plan.ts';

const [mode, input, destination] = process.argv.slice(2);
if (!['build', 'measure', 'check'].includes(mode) || !input || !destination)
  throw Error('layouts-run.ts <build|measure|check> <experiment.json|build directory> <fresh output>');
const out = resolve(destination);
if (mode === 'build' || mode === 'check') {
  const plan = experiment(JSON.parse(readFileSync(input, 'utf8')));
  if (mode === 'check') {
    console.log(`${plan.pairs.length} pairs × ${plan.seeds.length} layouts per arm; no workload executed`);
  } else {
    mkdirSync(out);
    writeFileSync(join(out, 'experiment.json'), JSON.stringify(plan, null, 2));
    const pairs = [], counts: Record<string, object> = {};
    for (const pair of plan.pairs) {
      const layouts = await linkLayouts(linkPlan(plan, pair), join(out, pair.name + '-' + pair.backend));
      pairs.push({name: pair.name, backend: pair.backend, layouts});
      counts[pair.name] = {n: pair.n, checksum: pair.checksum};
      writeFileSync(join(out, 'artifacts.json'), JSON.stringify({state: 'RUNNING', pairs}, null, 2));
    }
    writeFileSync(join(out, 'matched-plan.json'), JSON.stringify(counts, null, 2));
    writeFileSync(join(out, 'artifacts.json'), JSON.stringify({state: 'PASS', pairs}, null, 2));
  }
} else {
  const directory = resolve(input);
  const sampler = join(import.meta.dirname, 'layouts-measure.ts');
  const args = [sampler, join(directory, 'artifacts.json'), join(directory, 'matched-plan.json'), out];
  // Parse and validate before acquiring the reserved core. The sampler has no
  // import-time workload in --check mode.
  const check = spawnSync(process.execPath, [...args, '--check'], {stdio: 'inherit'});
  if (check.status !== 0 || check.signal || check.error) throw Error('layout sampling preflight failed');
  const lock = join(import.meta.dirname, '../gate/with-lock.sh');
  const run = spawnSync('sh', [lock, '--wait', process.execPath, ...args], {stdio: 'inherit'});
  if (run.status !== 0 || run.signal || run.error) throw Error('layout sampling failed; raw state retained');
}
