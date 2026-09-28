// The node options a module consults, from node v24.20.0
// `lib/internal/options.js` and `lib/internal/util.js`.
//
// Node parses its options once, at startup, from the command line and the
// environment, and modules ask `getOptionValue`. A compiled program has no
// option parser of node's: its `execArgv` is empty, so only the environment
// variables node documents as equivalents can turn one on, and the node-side
// run passes the test's own flags through `execArgv`. Each answer is read
// once, as node's is.

/** @ntsAbi managed */
declare function nts_process_exec_argv(): string[];
/** @ntsAbi managed */
declare function nts_process_env(name: string): string;

let pendingDeprecationRead = false;
let pendingDeprecation = false;

/**
 * Node's `isPendingDeprecation`: `--pending-deprecation` or
 * `NODE_PENDING_DEPRECATION=1`, unless `--no-deprecation` silences every
 * deprecation. Gates the warnings node is not yet ready to give everyone.
 */
export function isPendingDeprecation(): boolean {
  if (!pendingDeprecationRead) {
    pendingDeprecationRead = true;
    let pending = nts_process_env("NODE_PENDING_DEPRECATION") === "1";
    let silenced = false;
    for (const argument of nts_process_exec_argv()) {
      if (argument === "--pending-deprecation") pending = true;
      else if (argument === "--no-pending-deprecation") pending = false;
      else if (argument === "--no-deprecation") silenced = true;
    }
    pendingDeprecation = pending && !silenced;
  }
  return pendingDeprecation;
}
