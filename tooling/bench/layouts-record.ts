// Tool-written range tables retain one sitting's whole population. They are
// calibration observations, not a promise about unmeasured programs/layouts.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {layoutDeltas, spread} from './layouts.ts';

export function rangeTable(checkpoint: any, summaries: any[]) {
  if (checkpoint.state !== 'PASS' || checkpoint.current !== null || !Array.isArray(summaries) || !summaries.length)
    throw Error('only a complete PASS sitting can be recorded');
  const keys = new Set<string>();
  let rows = 0;
  const finite = (v: any) => typeof v === 'number' && Number.isFinite(v);
  const percent = (v: number) => (v * 100).toFixed(2) + '%';
  let table = '# Native layout ranges\n\nWritten by `tooling/bench/layouts-record.ts`. Each row retains every seeded layout from one sitting, with equal weight per layout. The layout range is (maximum − minimum) / mean over layout means; repeat drift is included separately in the decision floor. An effect smaller than its row’s layout range requires layout sampling. These ranges cover only the rows, backend, pins, linker, and layout count recorded here; unmeasured rows have no calibrated range. No cross-sitting host ratios are inferred.\n\n';
  table += '| Row | Backend | Layouts/arm | A mean/min/max µs | B mean/min/max µs | A/B SD µs | A/B layout range | Per-layout delta min/max (span) | Mean delta | Decision floor | Verdict |\n|---|---|---:|---|---|---|---|---|---:|---:|---|\n';
  for (const s of summaries) {
    const key = s.name + ':' + s.backend;
    if (keys.has(key) || !['c', 'llvm'].includes(s.backend) || !Array.isArray(s.layouts) || s.layouts.length < 5 ||
        new Set(s.layouts.map((l: any) => l.seed)).size !== s.layouts.length ||
        s.layouts.some((l: any) => l.rounds?.length !== 5)) throw Error('invalid layout population');
    keys.add(key); rows += s.layouts.length * 17;
    for (const layout of s.layouts) {
      if (!finite(layout.timeA) || !finite(layout.timeB)) throw Error('missing layout means');
      if (layout.rounds.some((r: any) => !finite(r.timeA) || !finite(r.timeB) || r.timeA <= 0 || r.timeB <= 0)) throw Error('missing bracket measurements');
      for (const arm of ['A', 'B']) {
        const mean = layout.rounds.reduce((n: number, r: any) => n + r['time' + arm], 0) / 5;
        if (Math.abs(layout['time' + arm] - mean) > Math.max(1e-9, mean * 1e-12)) throw Error('layout mean does not match brackets');
      }
    }
    for (const arm of [s.time?.base, s.time?.changed]) {
      if (!arm || ![arm.mean, arm.min, arm.max, arm.sd, arm.relativeRange].every(finite) || arm.min <= 0 || arm.max < arm.min)
        throw Error('invalid layout measurements');
    }
    if (![s.time.ratio, s.time.floor].every(finite) || s.time.ratio <= 0 || s.time.floor < 0) throw Error('invalid decision');
    const a = s.time.base, b = s.time.changed;
    for (const [arm, field] of [[a, 'timeA'], [b, 'timeB']] as const) {
      const actual = spread(s.layouts.map((l: any) => l[field]));
      for (const key of ['mean', 'min', 'max', 'sd', 'relativeRange'] as const)
        if (Math.abs(arm[key] - actual[key]) > Math.max(1e-9, Math.abs(actual[key]) * 1e-12)) throw Error('arm summary does not match layouts');
    }
    const verdict = Math.abs(s.time.ratio - 1) <= s.time.floor ? 'inside layout floor' : s.time.ratio < 1 ? 'improves' : 'REGRESSES';
    if (Math.abs(s.time.ratio - b.mean / a.mean) > 1e-12 || s.time.floor < Math.max(a.relativeRange, b.relativeRange) || s.time.verdict !== verdict)
      throw Error('decision does not match arm means/ranges');
    const times = (v: any) => [v.mean, v.min, v.max].map(n => (n / 1000).toFixed(3)).join('/');
    const deltas = layoutDeltas(s.layouts);
    table += '| ' + [s.name, s.backend, s.layouts.length, times(a), times(b),
      (a.sd / 1000).toFixed(3) + '/' + (b.sd / 1000).toFixed(3),
      percent(a.relativeRange) + '/' + percent(b.relativeRange),
      percent(deltas.min) + '/' + percent(deltas.max) + ' (' + percent(deltas.span) + ')', percent(s.time.ratio - 1),
      percent(s.time.floor), s.time.verdict].join(' | ') + ' |\n';
  }
  if (checkpoint.completed !== rows) throw Error('checkpoint population does not match summaries');
  return table;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, provenanceFile] = process.argv.slice(2);
  if (!input || !output) throw Error('layouts-record.ts <complete measurement directory> <fresh results directory> [provenance.json]');
  const checkpoint = JSON.parse(readFileSync(join(input, 'checkpoint.json'), 'utf8'));
  const summary = JSON.parse(readFileSync(join(input, 'summary.json'), 'utf8'));
  let table = rangeTable(checkpoint, summary);
  const rows = JSON.parse(readFileSync(join(input, 'rows.json'), 'utf8'));
  if (rows.length !== checkpoint.completed || rows.some((r: any) => r.code !== 0 || r.signal || !r.start?.utc || !r.end?.utc)) throw Error('raw row population failed');
  const load = rows.map((r: any) => {
    const token = /^(\d+(?:\.\d+)?)\s/.exec(r.start.load);
    if (!token) throw Error('missing host load');
    return Number(token[1]);
  });
  if (load.some((n: number) => !Number.isFinite(n))) throw Error('invalid host load');
  const conditions = {start: rows[0].start.utc, end: rows.at(-1).end.utc,
    loadMin: Math.min(...load), loadMax: Math.max(...load), gates: [...new Set(rows.map((r: any) => r.start.gate))]};
  const provenance = provenanceFile ? JSON.parse(readFileSync(provenanceFile, 'utf8')) : null;
  if (provenance?.calibration === true && (provenance.captureExperiments !== false || conditions.gates.some(g => g !== null) || conditions.loadMax > 2))
    throw Error('reference table requires no train/capture and load at most 2 throughout');
  table = table.replace('# Native layout ranges\n', '# Native layout ranges\n\n' +
    (provenance?.calibration === true ? 'Quiet reference sitting for future A/Bs.' : 'Change evidence only. Under a train or capture load, these ranges are upper bounds; future A/Bs consult the separate quiet-reference sitting.') + '\n');
  table += `\nSitting: ${conditions.start}–${conditions.end}; host load ${conditions.loadMin}–${conditions.loadMax}. Active train records: ${conditions.gates.map(g => g ?? 'none').join('; ')}.\n`;
  if (provenance) table += '\nCompiler/link provenance is retained in `ranges.json`.\n';
  mkdirSync(dirname(resolve(output)), {recursive: true});
  mkdirSync(output, {recursive: true});
  writeFileSync(join(output, 'ranges.md'), table);
  writeFileSync(join(output, 'ranges.json'), JSON.stringify({source: resolve(input), checkpoint, conditions, provenance,
    summary: summary.map((s: any) => ({...s, perLayoutDeltas: layoutDeltas(s.layouts)}))}, null, 2));
}
