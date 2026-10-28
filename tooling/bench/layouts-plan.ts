import type {LinkArm, LinkPlan} from './layouts-link.ts';

export type LayoutPair = {
  name: string;
  backend: 'c' | 'llvm';
  n: number;
  checksum: string;
  arms: LinkArm[];
};
export type LayoutExperiment = {seeds: number[]; pairs: LayoutPair[]};

/** Inputs are explicit link commands, not commands reconstructed from a
 * previous benchmark log. Both arms must use the counted native driver. */
export function experiment(value: any): LayoutExperiment {
  if (!value || !Array.isArray(value.seeds) || value.seeds.length < 5 ||
      new Set(value.seeds).size !== value.seeds.length ||
      value.seeds.some((s: any) => !Number.isSafeInteger(s) || s <= 0 || s > 0xffff_ffff) ||
      !Array.isArray(value.pairs) || !value.pairs.length) throw Error('five unique uint32 seeds and nonempty pairs required');
  const keys = new Set<string>();
  const counts = new Map<string, string>();
  for (const pair of value.pairs) {
    if (!/^[a-zA-Z0-9_-]+$/.test(pair.name) || !['c', 'llvm'].includes(pair.backend) ||
        !Number.isSafeInteger(pair.n) || pair.n <= 0 || !/^[0-9a-f]{16}$/.test(pair.checksum) ||
        !Number.isFinite(Buffer.from(pair.checksum, 'hex').readDoubleBE(0))) throw Error('invalid case/count/checksum');
    const key = pair.name + ':' + pair.backend;
    const work = JSON.stringify([pair.n, pair.checksum]);
    if (keys.has(key) || (counts.has(pair.name) && counts.get(pair.name) !== work)) throw Error('duplicate case or unmatched backend work');
    keys.add(key); counts.set(pair.name, work);
    if (!Array.isArray(pair.arms) || pair.arms.length !== 2 ||
        pair.arms.map((a: any) => a.name).sort().join() !== 'base,contents') throw Error('base/contents arms required');
    for (const arm of pair.arms) {
      if (typeof arm.command !== 'string' || !arm.command || typeof arm.cwd !== 'string' ||
          !Array.isArray(arm.args) || arm.args.some((a: any) => typeof a !== 'string') ||
          arm.args.some((a: string) => a === '-o' || a.startsWith('-Wl,--symbol-ordering-file')) ||
          !Array.isArray(arm.hot) || !arm.hot.length || arm.hot.some((s: any) => typeof s !== 'string' || !s)) throw Error('invalid link command');
    }
  }
  return value;
}

export function linkPlan(plan: LayoutExperiment, pair: LayoutPair): LinkPlan {
  return {arms: pair.arms, seeds: plan.seeds};
}
