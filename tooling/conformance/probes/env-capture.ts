// Does the compiled `nts_process_env` observe `process.env.X = "..."`?
//
// `os/test/core-static.js` sets `process.env.TMPDIR` and asserts what
// `os.tmpdir()` answers. That is the same *shape* as the stdout capture --
// a test mutating node state and expecting our module to see it -- but not
// necessarily the same answer: node's `process.env` setter calls `uv_os_setenv`,
// which updates the real environment, so a C `getenv` may observe it where a C
// `write(1, …)` cannot observe a reassigned `process.stdout.write`.
//
// The shape of a case does not decide its answer. This measures it.
declare function nts_process_env(name: string): string;

export function readThroughTheBinding(name: string): string {
  return nts_process_env(name);
}
