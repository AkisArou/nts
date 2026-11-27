import { lstatSync, readFileSync } from 'node:fs';
import { basename, normalize, isAbsolute } from 'node:path';

export const HERE_REF = 'refs/worktree/nts-here-replay';
export const hereRestorePath = (tree: string): string => `${tree}.here-restore.json`;

type RestoreCheckout = {
  branch: string;
  head: string;
  tip: string;
  ref: typeof HERE_REF;
  run: string;
};
export type HereRestore = RestoreCheckout & {
  version: 2;
  phase: 'parking' | 'checking' | 'returning';
  inputs: {
    root: string;
    links: Record<string, string>;
    catalog: { bytes: string; sha256: string } | null;
    installation: string | null;
    parked: {path: string; slot: string; device: string; inode: string}[];
    candidate: string[];
  };
};

const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
const sha256 = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const localDirectory = (path: unknown): path is string => typeof path === 'string' && !isAbsolute(path) &&
  normalize(path) === path && !path.startsWith('../') && basename(path) === 'node_modules' && !path.includes('\0');
const integer = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value);
const encoded = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value);

/** A missing receipt is the only observation that grants ordinary tree use. */
export function hereRestore(tree: string): HereRestore | null {
  const path = hereRestorePath(tree);
  try {
    if (!lstatSync(path).isFile()) throw Error('not a regular file');
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<HereRestore>;
    if (typeof value.branch !== 'string' || value.branch === 'main' ||
        !/^[\w.][\w./-]*$/.test(value.branch) || value.branch.includes('..') || !sha(value.head) || !sha(value.tip) ||
        value.ref !== HERE_REF || typeof value.run !== 'string' || !/^here-[a-f0-9]{12}-\d+$/.test(value.run) ||
        !value.inputs || typeof value.inputs.root !== 'string' || !isAbsolute(value.inputs.root) ||
        !value.inputs.links || Array.isArray(value.inputs.links) || typeof value.inputs.links !== 'object' ||
        Object.entries(value.inputs.links).some(([name, link]) => !name || name === '.' || name === '..' || basename(name) !== name || name.includes('\0') || typeof link !== 'string')) throw Error('invalid restore record');
    if (value.version !== 2 || !value.phase || !['parking', 'checking', 'returning'].includes(value.phase) ||
        !(value.inputs.catalog === null || value.inputs.catalog && encoded(value.inputs.catalog.bytes) && sha256(value.inputs.catalog.sha256)) ||
        !(value.inputs.installation === null || encoded(value.inputs.installation)) ||
        !Array.isArray(value.inputs.candidate) || !value.inputs.candidate.every(localDirectory) ||
        !Array.isArray(value.inputs.parked) || !value.inputs.parked.every((row, index) => row && localDirectory(row.path) && row.slot === String(index) && integer(row.device) && integer(row.inode))) throw Error('invalid saved inputs');
    return value as HereRestore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw Error(`cannot read --here restore record ${path}: ${String(error)}`);
  }
}

export function hereRestoreNeeded(tree: string): string {
  return `--here checkout protected by ${hereRestorePath(tree)}; run check.ts HEAD --here in ${tree} to restore it`;
}

export function assertNoHereRestore(tree: string): void {
  if (hereRestore(tree)) throw Error(hereRestoreNeeded(tree));
}
