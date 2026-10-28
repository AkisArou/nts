// Independent joint code/heap layouts are the sampling units. Hot repeats
// within a layout improve its mean; they never inflate the bootstrap sample.
import {spread} from './layouts.ts';

export type Bracket = {before: number; changed: number; after: number};
export type LayoutSample = {id: string; rounds: Bracket[]};
export type IntervalOptions = {confidence?: number; resamples?: number; seed?: number};

export function random(seed: number) {
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffff_ffff) throw Error('nonzero uint32 seed required');
  let state = seed >>> 0;
  return () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0;};
}

function quantile(values: number[], fraction: number) {
  const position = fraction * (values.length - 1), lower = Math.floor(position);
  return values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower);
}

/** Percentile cluster-bootstrap interval for the ratio of equally weighted
 * arm layout means. This is an empirical interval over the chosen randomizer,
 * not a universal bound over every possible placement or machine condition. */
export function inferLayouts(input: readonly LayoutSample[], options: IntervalOptions = {}) {
  const confidence = options.confidence ?? 0.99, resamples = options.resamples ?? 20_000, seed = options.seed ?? 0x13579bdf;
  if (input.length < 20 || input.length > 1000 || new Set(input.map(s => s.id)).size !== input.length)
    throw Error('twenty unique independent layouts required');
  if (!Number.isFinite(confidence) || confidence < 0.9 || confidence > 0.999 || !Number.isSafeInteger(resamples)
    || resamples < 2000 || resamples > 200_000 || input.length * resamples > 5_000_000 || resamples * (1 - confidence) < 40)
    throw Error('invalid or under-resolved interval configuration');
  const draw = random(seed), mean = (values: number[]) => values.reduce((n, v) => n + v, 0) / values.length;
  const count = input[0].rounds.length;
  if (count < 3 || count > 25) throw Error('three to twenty-five brackets per layout required');
  const layouts = [...input].sort((a,b) => a.id.localeCompare(b.id,'en')).map(sample => {
    if (!sample.id || sample.rounds.length !== count || sample.rounds.some(r =>
      [r.before,r.changed,r.after].some(v => !Number.isFinite(v) || v <= 0 || v > Number.MAX_SAFE_INTEGER))) throw Error('invalid or incomplete layout brackets');
    const base = mean(sample.rounds.map(r => Math.sqrt(r.before) * Math.sqrt(r.after)));
    const changed = mean(sample.rounds.map(r => r.changed));
    return {id: sample.id, base, changed, delta: changed / base - 1,
      repeatDrift: Math.max(...sample.rounds.map(r => Math.abs(r.after / r.before - 1)))};
  });
  const base = spread(layouts.map(l => l.base)), changed = spread(layouts.map(l => l.changed));
  const samples: number[] = [];
  for (let repeat = 0; repeat < resamples; repeat++) {
    let sumA = 0, sumB = 0;
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[draw() % layouts.length];
      sumA += layout.base; sumB += layout.changed;
    }
    samples.push(sumB / sumA - 1);
  }
  samples.sort((a,b) => a - b);
  const tail = (1 - confidence) / 2;
  const low = quantile(samples,tail), high = quantile(samples,1-tail), delta = changed.mean / base.mean - 1;
  const verdict = high < 0 ? 'improvement' : low > 0 ? 'regression' : 'noise';
  return {method: 'paired-layout-cluster-bootstrap-percentile-v1', confidence, resamples, seed,
    independentLayouts: layouts.length, bracketsPerLayout: count, delta, interval: {low,high}, verdict,
    base, changed, perLayoutDelta: {min: Math.min(...layouts.map(l => l.delta)), max: Math.max(...layouts.map(l => l.delta))},
    maximumRepeatDrift: Math.max(...layouts.map(l => l.repeatDrift)), layouts};
}
