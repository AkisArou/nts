/* `isatty`, over libuv's handle classification.
 *
 * `uv_guess_handle(fd)` is what node itself calls: it answers what kind of thing
 * a descriptor is, and `UV_TTY` is the answer for a terminal. It is not
 * `isatty(3)` -- on Windows there is no such call and libuv's is the portable
 * question -- and node's `tty.isatty` is this and a range check.
 *
 * # Why the range check is in the C and not only the TypeScript
 *
 * `uv_guess_handle` takes an `int`. A `double` from JavaScript can be `-1`,
 * `2 ** 31`, `1.1` or a string coerced to `NaN`, and node answers `false` for
 * every one of them rather than passing them down. `pseudo-tty/test-tty-isatty.js`
 * asserts exactly those four, so the guard is the behaviour under test and not a
 * defensive habit.
 */

#ifndef NTS_TTY_H
#define NTS_TTY_H

#include "nts_runtime.h"

/** Whether `fd` names a terminal. False for anything not a non-negative int32. */
bool nts_tty_isatty(double fd);

#endif /* NTS_TTY_H */
