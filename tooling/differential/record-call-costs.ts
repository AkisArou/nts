// Publish CPU calibration from validated complete differential observations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseJsonReport} from './check-report.ts';

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const integer = (value: unknown): number => {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid CPU sample');
  return value;
};

/** A measured maximum supplies the allowance; no historical aggregate is a call. */
export function calibration(nativeRoot: string, jvmRoot: string, multiple: number, idleSeconds: number) {
  assert.ok(Number.isSafeInteger(multiple) && multiple > 1, 'invalid calibration multiplier');
  assert.ok(Number.isSafeInteger(idleSeconds) && idleSeconds > 0, 'invalid inactivity guard');
  const arms: Record<string, unknown> = {};
  for (const arm of ['c', 'llvm', 'sanitized', 'jvm']) {
    const root = arm === 'jvm' ? jvmRoot : nativeRoot, area = join(root, arm), summary = read(join(root, 'result.json'));
    assert.ok(summary.finished, 'calibration sitting did not finish');
    const sitting = summary.arms.find((value: {name: string}) => value.name === arm);
    assert.ok(sitting?.finished, 'calibration arm did not finish');
    assert.equal(sitting.backend, arm === 'sanitized' ? 'c' : arm);
    assert.equal(sitting.sanitizer, arm === 'sanitized' ? 'address' : null);
    const rows = new Map<string, ReturnType<typeof read>>();
    const excluded: {fixture: string; status: string}[] = [];
    for (const name of readdirSync(area).filter(name => name.endsWith('.json')).sort()) {
      const row = read(join(area, name));
      assert.equal(name, `${row.fixture}.json`);
      assert.ok(!rows.has(row.fixture), 'duplicate calibration project');
      const report = parseJsonReport(JSON.stringify(row.report), row.status);
      if (row.error || row.incomplete || !['agrees', 'partial'].includes(report.status)) {
        excluded.push({fixture: row.fixture, status: report.status});
      } else rows.set(row.fixture, row);
    }
    const seen = new Set<string>(), seals: Record<string, string> = {};
    let calls = 0, maximum = {cpu_ticks: 0, clock_ticks_per_second: 1, fixture: '', index: 0, includes_startup: false};
    for (const name of readdirSync(join(area, 'costs')).filter(name => /^check-.*\.jsonl$/.test(name)).sort()) {
      const path = join(area, 'costs', name);
      const events = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const header = events[0], fixture = basename(header.project).replace(/\.tsconfig\.json$/, '');
      if (!rows.has(fixture)) continue;
      assert.equal(header.event, 'case'); assert.equal(header.step, 'bench-agree');
      assert.equal(header.binary_sha, summary.pin.sha); assert.equal(header.backend, sitting.backend);
      assert.ok(!seen.has(fixture), 'more than one trace per accepted project'); seen.add(fixture);
      const observed = events.filter(value => value.event === 'program.call');
      assert.equal(observed.length, rows.get(fixture).report.counts.compared, 'completed calls differ from validated comparisons');
      const indexes = new Set<number>();
      for (const event of observed) {
        integer(event.cpu_ticks); integer(event.index); integer(event.clock_ticks_per_second);
        assert.ok(event.clock_ticks_per_second > 0, 'missing CPU clock resolution');
        assert.equal(event.cpu_scope, 'driver-process-all-threads-and-waited-children');
        assert.equal(typeof event.includes_startup, 'boolean');
        assert.ok(!indexes.has(event.index), 'duplicate completed call'); indexes.add(event.index);
        const sample = {cpu_ticks: event.cpu_ticks, clock_ticks_per_second: event.clock_ticks_per_second,
          fixture, index: event.index, includes_startup: event.includes_startup};
        if (sample.cpu_ticks / sample.clock_ticks_per_second > maximum.cpu_ticks / maximum.clock_ticks_per_second) maximum = sample;
      }
      calls += observed.length;
      seals[`${arm}/costs/${name}`] = hash(path);
      seals[`${arm}/${fixture}.json`] = hash(join(area, `${fixture}.json`));
    }
    assert.equal(seen.size, rows.size, 'an accepted project lacks its CPU observations');
    const observedMax = maximum.cpu_ticks / maximum.clock_ticks_per_second;
    assert.ok(observedMax > 0 && calls > 0, 'no measurable completed calls');
    arms[arm] = {observed_max_cpu_seconds: observedMax, multiplier: multiple,
      allowance_seconds: Math.ceil(observedMax * multiple), accepted_projects: rows.size, completed_calls: calls,
      maximum, excluded, compiler: summary.pin, node: summary.node, nice: summary.nice, affinity: summary.affinity,
      load: sitting.load, runner_sha256: hash(join(root, 'run.mjs')), evidence: seals};
    delete (arms[arm] as {compiler: {path?: string}}).compiler.path;
  }
  return {version: 1, cpu_scope: 'driver-process-all-threads-and-waited-children',
    first_call_includes_startup: true, cleanup_uses_same_allowance: true, idle_seconds: idleSeconds, arms};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [native, jvm, out, multiplier, idle, ...extra] = process.argv.slice(2);
  assert.ok(native && jvm && out && !extra.length, 'usage: record-call-costs.ts <native sitting> <JVM sitting> <output> <multiple> <idle seconds>');
  const value = calibration(native, jvm, Number(multiplier), Number(idle));
  mkdirSync(dirname(out), {recursive: true}); writeFileSync(out, JSON.stringify(value, null, 2) + '\n');
  for (const [arm, row] of Object.entries(value.arms) as [string, {observed_max_cpu_seconds: number; allowance_seconds: number}][]) {
    console.log(`${arm}: observed ${row.observed_max_cpu_seconds} CPU s; allowance ${row.allowance_seconds} CPU s`);
  }
}
