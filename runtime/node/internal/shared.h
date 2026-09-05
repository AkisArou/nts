/* What every binding file needs, and nothing else.
 *
 * `NtsString` is UTF-16 code units and libuv takes UTF-8, so a conversion sits
 * between every path argument and every syscall. It lives here so there is one
 * of it. */
#ifndef NTS_NODE_SHARED_H
#define NTS_NODE_SHARED_H
#include <stddef.h>
#include "nts_runtime.h"

/** UTF-16 code units to a NUL-terminated UTF-8 buffer. Returns the byte count. */
size_t nts_node_to_utf8(const NtsString *s, char *buf, size_t cap);

/** Allocate an exact-capacity NUL-terminated UTF-8 buffer. The caller frees it. */
char *nts_node_to_utf8_alloc(const NtsString *s, size_t *length);

/** libuv returns -errno; the TypeScript above maps the number to a code. */
void nts_node_set_errno(int uv_result);

/** The process-global errno slot used by result-plus-errno bindings. */
double nts_errno(void);

/** Native line ending used by Web/File API normalization. */
NtsString *nts_node_eol(void);

/** Cryptographically random RFC 4122 version-4 identifier. */
NtsString *nts_node_random_uuid(void);

/** The positive libuv error code from the most recent UUID operation. */
double nts_node_random_uuid_status(void);

/** libuv's platform error table and its two direct lookup operations. */
NtsString *nts_uv_err_name(double code);
NtsString *nts_uv_err_message(double code);
NtsArray *nts_uv_error_codes(void);
NtsArray *nts_uv_error_names(void);

/* An array of doubles.
 *
 * The runtime exports `nts_desc_ref` for an array of references and nothing for
 * an array of numbers, because a program that needs one emits its own into
 * `program.c` -- and those are `static`. A binding is a separate translation
 * unit, so it needs its own. Same shape, same meaning: eight bytes an element
 * and nothing in them for a collector to trace. */
extern const NtsDescriptor nts_node_desc_double;

#endif
