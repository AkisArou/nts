#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "shared.h"

const NtsDescriptor nts_node_desc_double = {
    NTS_KIND_ARRAY, sizeof(double), 0, 0, 0, 0, "double", 0, 0};

/* A loaded addon can be shared by Node workers. Result-plus-status calls are
 * synchronous, but their status still belongs to the calling runtime thread. */
static _Thread_local int last_errno = 0;

double nts_errno(void) { return (double)last_errno; }

NtsString *nts_node_eol(void) {
#ifdef _WIN32
    return nts_string_from_utf8("\r\n", 2);
#else
    return nts_string_from_utf8("\n", 1);
#endif
}

static _Thread_local int random_uuid_status = 0;

double nts_node_random_uuid_status(void) {
    return (double)random_uuid_status;
}

NtsString *nts_node_random_uuid(void) {
    uint8_t bytes[16];
    int result = uv_random(NULL, NULL, bytes, sizeof(bytes), 0, NULL);
    random_uuid_status = result < 0 ? -result : 0;
    if (result < 0) return nts_string_from_utf8("", 0);

    bytes[6] = (uint8_t)((bytes[6] & 0x0f) | 0x40);
    bytes[8] = (uint8_t)((bytes[8] & 0x3f) | 0x80);

    static const char hexadecimal[] = "0123456789abcdef";
    char text[36];
    size_t at = 0;
    for (size_t index = 0; index < sizeof(bytes); index++) {
        if (index == 4 || index == 6 || index == 8 || index == 10) {
            text[at++] = '-';
        }
        uint8_t byte = bytes[index];
        text[at++] = hexadecimal[byte >> 4];
        text[at++] = hexadecimal[byte & 0x0f];
    }
    return nts_string_from_utf8(text, 36);
}

void nts_node_set_errno(int uv_result) {
    last_errno = uv_result < 0 ? -uv_result : 0;
}

size_t nts_node_to_utf8(const NtsString *s, char *buf, size_t cap) {
    if (cap == 0) return 0;
    size_t n = 0;
    for (uint32_t i = 0; i < s->length; i++) {
        uint32_t code_point = nts_unit(s, i);
        if (code_point >= 0xD800 && code_point <= 0xDBFF &&
            i + 1 < s->length) {
            uint32_t low = nts_unit(s, i + 1);
            if (low >= 0xDC00 && low <= 0xDFFF) {
                code_point = 0x10000 + ((code_point - 0xD800) << 10) +
                             (low - 0xDC00);
                i++;
            }
        }
        // V8's UTF-8 conversion replaces an unpaired UTF-16 surrogate rather
        // than emitting its invalid three-byte encoding.
        if (code_point >= 0xD800 && code_point <= 0xDFFF) code_point = 0xFFFD;

        size_t needed = code_point < 0x80      ? 1
                        : code_point < 0x800   ? 2
                        : code_point < 0x10000 ? 3
                                               : 4;
        if (n + needed >= cap) break;

        if (needed == 1) {
            buf[n++] = (char)code_point;
        } else if (needed == 2) {
            buf[n++] = (char)(0xC0 | (code_point >> 6));
            buf[n++] = (char)(0x80 | (code_point & 0x3F));
        } else if (needed == 3) {
            buf[n++] = (char)(0xE0 | (code_point >> 12));
            buf[n++] = (char)(0x80 | ((code_point >> 6) & 0x3F));
            buf[n++] = (char)(0x80 | (code_point & 0x3F));
        } else {
            buf[n++] = (char)(0xF0 | (code_point >> 18));
            buf[n++] = (char)(0x80 | ((code_point >> 12) & 0x3F));
            buf[n++] = (char)(0x80 | ((code_point >> 6) & 0x3F));
            buf[n++] = (char)(0x80 | (code_point & 0x3F));
        }
    }
    buf[n] = 0;
    return n;
}

char *nts_node_to_utf8_alloc(const NtsString *s, size_t *length) {
    if ((size_t)s->length > (SIZE_MAX - 1) / 3) return NULL;
    size_t capacity = (size_t)s->length * 3 + 1;
    char *buffer = malloc(capacity);
    if (buffer == NULL) return NULL;
    size_t written = nts_node_to_utf8(s, buffer, capacity);
    if (length != NULL) *length = written;
    return buffer;
}

/* libuv's own name and message for an error code. Node exposes the same pair
 * through `internalBinding('uv')`; taking them from libuv rather than from a
 * table means they cannot drift from the platform. */
NtsString *nts_uv_err_name(double code) {
    const char *name = uv_err_name((int)code);
    return nts_string_from_utf8(name, name ? strlen(name) : 0);
}

NtsString *nts_uv_err_message(double code) {
    const char *message = uv_strerror((int)code);
    return nts_string_from_utf8(message, message ? strlen(message) : 0);
}

/* Expand libuv's own table, exactly as node does in `src/uv.cc`. Keeping the
 * two columns in static C arrays means the TypeScript can assemble its typed
 * Map without a hand-maintained list or an erased array crossing the seam. */
#define NTS_UV_ERROR_COUNT(name, message) +1
enum { NTS_UV_ERROR_COUNT_VALUE = 0 UV_ERRNO_MAP(NTS_UV_ERROR_COUNT) };
#undef NTS_UV_ERROR_COUNT

#define NTS_UV_ERROR_CODE(name, message) UV_##name,
static const int uv_error_codes[NTS_UV_ERROR_COUNT_VALUE] = {
    UV_ERRNO_MAP(NTS_UV_ERROR_CODE)
};
#undef NTS_UV_ERROR_CODE

#define NTS_UV_ERROR_NAME(name, message) #name,
static const char *const uv_error_names[NTS_UV_ERROR_COUNT_VALUE] = {
    UV_ERRNO_MAP(NTS_UV_ERROR_NAME)
};
#undef NTS_UV_ERROR_NAME

NtsArray *nts_uv_error_codes(void) {
    NtsArray *codes =
        nts_array_new(&nts_node_desc_double, NTS_UV_ERROR_COUNT_VALUE);
    for (size_t i = 0; i < NTS_UV_ERROR_COUNT_VALUE; i++) {
        NTS_ITEMS(codes, double)[i] = (double)uv_error_codes[i];
    }
    return codes;
}

NtsArray *nts_uv_error_names(void) {
    NtsArray *names = nts_array_new(&nts_desc_ref, NTS_UV_ERROR_COUNT_VALUE);
    for (size_t i = 0; i < NTS_UV_ERROR_COUNT_VALUE; i++) {
        const char *name = uv_error_names[i];
        NTS_ITEMS(names, NtsString *)[i] = nts_string_from_utf8(name, strlen(name));
    }
    return names;
}
