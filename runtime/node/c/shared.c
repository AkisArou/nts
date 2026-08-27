#include <string.h>
#include "shared.h"

const NtsDescriptor nts_desc_double = {NTS_KIND_ARRAY, sizeof(double), 0, 0, 0, 0,
                                       "double"};

static int last_errno = 0;

double nts_errno(void) { return (double)last_errno; }

void nts_node_set_errno(int uv_result) {
    last_errno = uv_result < 0 ? -uv_result : 0;
}

size_t nts_node_to_utf8(const NtsString *s, char *buf, size_t cap) {
    size_t n = 0;
    for (uint32_t i = 0; i < s->length && n + 4 < cap; i++) {
        uint16_t u = nts_unit(s, i);
        if (u < 0x80) {
            buf[n++] = (char)u;
        } else if (u < 0x800) {
            buf[n++] = (char)(0xC0 | (u >> 6));
            buf[n++] = (char)(0x80 | (u & 0x3F));
        } else {
            buf[n++] = (char)(0xE0 | (u >> 12));
            buf[n++] = (char)(0x80 | ((u >> 6) & 0x3F));
            buf[n++] = (char)(0x80 | (u & 0x3F));
        }
    }
    buf[n] = 0;
    return n;
}

/* libuv's own name and message for an error code. Node exposes the same pair
 * through `internalBinding('uv')`; taking them from libuv rather than from a
 * table means they cannot drift from the platform. */
#include <uv.h>

NtsString *nts_uv_err_name(double code) {
    const char *name = uv_err_name((int)code);
    return nts_string_from_utf8(name, name ? strlen(name) : 0);
}

NtsString *nts_uv_err_message(double code) {
    const char *message = uv_strerror((int)code);
    return nts_string_from_utf8(message, message ? strlen(message) : 0);
}
