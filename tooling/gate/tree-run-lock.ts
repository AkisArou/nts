import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProcessStat } from '../differential/process-stat/main.ts';

export const treeRunLockPath = (tree: string): string => join(tree, 'target', '.gate-run.lock');

/** A gate's PID file gives evidence of use only while its process is live. */
export function liveTreeRunLock(path: string): { pid: number; run: string } | null {
  let text: string;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const entry = /^([1-9][0-9]*) ([^\n]+)\n?$/.exec(text);
  const pid = Number(entry?.[1]);
  if (!entry || !Number.isSafeInteger(pid)) throw Error(`invalid gate runner lock ${path}`);
  return readProcessStat(pid)?.live ? {pid, run:entry[2]!} : null;
}
