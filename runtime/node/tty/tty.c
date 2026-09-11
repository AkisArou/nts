#include "nts_tty.h"

#include <uv.h>

bool nts_tty_isatty(double fd) {
    /* Node's own guard, in this order: an integer, in range, and not negative.
     * `1.1` fails the first, `2 ** 31` the second, `-1` the third. A string
     * arrives here as NaN, which fails the first because NaN != NaN. */
    if (fd != fd) return false;
    if (fd != (double)(int)fd) return false;
    if (fd < 0.0 || fd > 2147483647.0) return false;
    return uv_guess_handle((uv_file)(int)fd) == UV_TTY;
}
