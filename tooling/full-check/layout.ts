// Persistent service paths, shared with disk upkeep without importing service state.
import {homedir} from 'node:os';
import {join} from 'node:path';

export type Layout = {
  /** ~/.cache/nts-full-check: everything the full check owns. */
  home: string;
  /** The gate tree pinned.sh checks each measured commit out in. */
  tree: string;
  /** Its cargo target. */
  target: string;
  /** The worktree the service's own code runs from, at `verified`. */
  controller: string;
  /**
   * Held shared by a process that reads the controller's tree while the
   * service runs (the hourly count), and alone by the service to move that
   * tree to `verified` (service.ts's followVerified).
   */
  controllerLock: string;
  /**
   * Each part's records tree: its records unit records there at the run's
   * commit, and the controller applies their delta there on main. Each builds
   * what it builds in its own `target/`.
   */
  records: Readonly<Record<'core'|'wide', string>>;
  /**
   * The nightly benchmarks' tree: the benchmarks unit measures there at
   * verified, and the controller publishes the run's record there on main.
   */
  bench: string;
  runs: string;
  state: string;
  /** The hourly count's own result (service.ts --count). */
  count: string;
  lock: string;
};

export function layout(cache = join(homedir(), ".cache")): Layout {
  const home = join(cache, "nts-full-check");
  return {
    home,
    tree: join(home, "tree"),
    target: join(home, "target"),
    controller: join(home, "controller"),
    controllerLock: join(home, "controller.lock"),
    records: { core: join(home, "records", "core"), wide: join(home, "records", "wide") },
    bench: join(home, "bench"),
    runs: join(home, "runs"),
    state: join(home, "state-v2.json"),
    count: join(home, "count.json"),
    lock: join(home, "service.lock"),
  };
}

