/* The synchronous half of `node:child_process`, over `uv_spawn`.
 *
 * # Why the synchronous family first, and alone
 *
 * `spawnSync`, `execSync` and `execFileSync` run a child to completion and hand
 * back its status, its stdout and its stderr. There is no `ChildProcess` object,
 * no event emitter, no stdio streams and no reference counting -- the whole
 * contract is "run this, wait, give me three values". That makes it the one part
 * of the module whose C can be written and finished rather than carried.
 *
 * The asynchronous family (`spawn`, `exec`, `execFile`, `fork`) needs a live
 * `ChildProcess` with `stdout`/`stderr` as readable streams and an `exit` event
 * ordered against them, which is a different piece of work and not this one.
 * `src/main.ts` declares only what is implemented; nothing is stubbed, because a
 * present-but-inert `spawn` would make `'spawn' in cp` answer true and send a
 * program down the wrong branch. That is the same reasoning `dns` records for
 * `resolve*`.
 *
 * # One binding, not three
 *
 * `execSync` and `execFileSync` are `spawnSync` plus argument shaping and plus a
 * throw on non-zero status, and node builds them that way too -- both land in the
 * same `spawnSync` in `lib/child_process.js`. Doing that shaping in TypeScript
 * keeps the C to a single entry point whose contract is small enough to state:
 * given a file, an argv, an env, a cwd and stdin bytes, run it and report.
 *
 * # What the result carries, and why stdout is bytes
 *
 * `stdout` and `stderr` come back as byte arrays rather than strings. A child's
 * output is not required to be UTF-8, and node's own `spawnSync` returns Buffers
 * unless an `encoding` is asked for. Decoding in C would make `encoding: 'buffer'`
 * -- which is the default -- impossible to serve, and would corrupt any child
 * that writes binary.
 */

#ifndef NTS_CHILD_PROCESS_H
#define NTS_CHILD_PROCESS_H

#include "nts_runtime.h"

/* Run `file` with `args` to completion.
 *
 * `args` includes argv[0]; `env` is a flat array of "KEY=VALUE" strings, or NULL
 * to inherit; `cwd` is "" to inherit. `input` is written to the child's stdin and
 * may be NULL. `timeout_ms` is 0 for none.
 *
 * The callback receives, in order:
 *   status      the exit code, or -1 if the child was signalled
 *   signal      the terminating signal number, or 0
 *   stdout      the child's standard output, as bytes
 *   stderr      the child's standard error, as bytes
 *   error       "" on success, otherwise a libuv error name such as "ENOENT"
 *   pid         the child's process id, or 0 if it never started
 */
NtsHeader *nts_child_process_spawn_sync(const NtsString *file, NtsHeader *args,
                                        NtsHeader *env, const NtsString *cwd,
                                        NtsHeader *input, double timeout_ms,
                                        double max_buffer, NtsHeader *callback);

/* ----------------------------------------------------------- asynchronous */

/* Start `file` with `args` and keep it. Returns a handle >= 0, or a negative
 * libuv error.
 *
 * `stdio_mode` is three flags packed as `in | (out << 2) | (err << 4)`: 0 for a
 * pipe, 1 to inherit the parent's descriptor, 2 to ignore. Node's `stdio` option
 * has more spellings than that -- an fd, a stream, 'overlapped' -- and the ones
 * that reach here are the three every other spelling reduces to.
 *
 * `on_exit` receives the status and the terminating signal. It fires once. The
 * handle stays valid until `nts_child_process_close`, because node's `exit` and
 * `close` are separate events and a caller may still read buffered output
 * between them.
 */
double nts_child_process_spawn(const NtsString *file, NtsHeader *args,
                               NtsHeader *env, const NtsString *cwd,
                               double stdio_mode, double detached,
                               NtsHeader *on_exit, NtsHeader *on_error);

/** Begin reading a child's stdout (`which` 1) or stderr (`which` 2). */
void nts_child_process_read_start(double handle, double which,
                                  NtsHeader *on_data, NtsHeader *on_end);

/** Write to the child's stdin. `callback` fires when the write completes. */
double nts_child_process_write(double handle, NtsView *bytes, NtsHeader *callback);

/** Close the child's stdin, which is how a child sees EOF. */
void nts_child_process_end_stdin(double handle);

/** `kill(2)` on the child. Returns 0 or a negative libuv error. */
double nts_child_process_kill(double handle, double signal);

/** The child's process id, or 0 if it never started. */
double nts_child_process_pid(double handle);

/** Release the handle and everything it owns. */
void nts_child_process_close(double handle);

#endif /* NTS_CHILD_PROCESS_H */
