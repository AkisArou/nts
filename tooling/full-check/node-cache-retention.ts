// Recomputable code caches are upkeep, never a verdict input. Node publishes
// entries atomically; serialize collectors and recheck candidates before unlink.
import { lstatSync, readdirSync, realpathSync, unlinkSync, type Stats } from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NODE_COMPILE_CACHE_ROOT } from "../gate/canonical-environment.ts";
import { acquire, type Lock } from "../landing/lock.ts";

export const NODE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const NODE_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export type NodeCacheRetention = {
  root: string; state: "complete" | "missing" | "busy" | "warning";
  removed: number; removedBytes: number; kept: number; keptBytes: number;
  changed: number; skipped: number; errors: string[];
};
type Options = { home?: string; now?: number; maxBytes?: number; onAttempt?: (path: string) => void };
type Entry = { path: string; stat: Stats; touched: number };
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
const touch = (stat: Stats): number => Math.max(stat.atimeMs, stat.mtimeMs);
const same = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.atimeMs === b.atimeMs;

export function pruneNodeCompileCache(options: Options = {}): NodeCacheRetention {
  const home = options.home ?? userInfo().homedir;
  // Fixture homes relocate the one exported authority; there is no second
  // spelling of its suffix and tests never collect the user's shared cache.
  const root = resolve(home, relative(userInfo().homedir, NODE_COMPILE_CACHE_ROOT));
  const result: NodeCacheRetention = { root, state: "complete", removed: 0, removedBytes: 0,
    kept: 0, keptBytes: 0, changed: 0, skipped: 0, errors: [] };
  const now = options.now ?? Date.now(), maxBytes = options.maxBytes ?? NODE_CACHE_MAX_BYTES;
  let lock: Lock | null = null;
  const warning = (error: unknown) => { result.state = "warning"; result.errors.push(String(error)); };
  try {
    if (!isAbsolute(home) || !Number.isFinite(now) || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new Error("invalid Node cache retention policy");
    const ownedDirectory = (path: string): Stats => {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || realpathSync(path) !== resolve(path))
        throw new Error(`Node cache is not an owned real directory: ${path}`);
      return stat;
    };
    let initial: Stats;
    try { initial = ownedDirectory(root); }
    catch (error) { if (missing(error)) { result.state = "missing"; return result; } throw error; }
    lock = acquire(join(dirname(root), "retention.lock"));
    if (!lock) { result.state = "busy"; return result; }
    const identity = ownedDirectory(root);
    if (initial.dev !== identity.dev || initial.ino !== identity.ino) throw new Error("Node cache root changed before collection");
    const files: Entry[] = [], pending = [root];
    while (pending.length) {
      const directory = pending.pop()!;
      try {
        ownedDirectory(directory);
        for (const name of readdirSync(directory)) {
          const path = join(directory, name);
          try {
            const stat = lstatSync(path);
            if (stat.isSymbolicLink() || stat.uid !== process.getuid?.()) { result.skipped++; continue; }
            if (stat.isDirectory()) pending.push(path);
            else if (stat.isFile()) files.push({ path, stat, touched: touch(stat) });
            else result.skipped++;
          } catch (error) { if (!missing(error)) warning(error); }
        }
      } catch (error) { if (!missing(error)) warning(error); }
    }
    files.sort((a, b) => a.touched - b.touched || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    result.kept = files.length; result.keptBytes = files.reduce((sum, file) => sum + file.stat.size, 0);
    for (const file of files) {
      // Fresh empty siblings may be in Node's atomic publish path. Removing
      // one cannot improve the byte bound, even when another entry changed.
      if (now - file.touched <= NODE_CACHE_MAX_AGE_MS && (file.stat.size === 0 || result.keptBytes <= maxBytes)) continue;
      try {
        options.onAttempt?.(file.path);
        const currentRoot = ownedDirectory(root);
        if (identity.dev !== currentRoot.dev || identity.ino !== currentRoot.ino) throw new Error("Node cache root changed during collection");
        ownedDirectory(dirname(file.path));
        const current = lstatSync(file.path);
        if (!current.isFile() || current.isSymbolicLink() || !same(file.stat, current)) {
          result.changed++; result.keptBytes += current.size - file.stat.size; continue;
        }
        unlinkSync(file.path);
        result.removed++; result.removedBytes += current.size; result.kept--; result.keptBytes -= current.size;
      } catch (error) {
        if (missing(error)) { result.changed++; result.kept--; result.keptBytes -= file.stat.size; }
        else warning(error);
      }
    }
    if (result.keptBytes > maxBytes) warning(`Node cache remains above ${maxBytes} bytes after changed or inaccessible entries were retained`);
  } catch (error) { warning(error); }
  finally { if (lock) { try { lock.release(); } catch (error) { warning(error); } } }
  return result;
}
