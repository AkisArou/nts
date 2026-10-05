#ifndef NTS_STRING_VIEW_H
#define NTS_STRING_VIEW_H

/* A string lent to a foreign function for one call: `StringView` in
 * `c:types`.
 *
 * The compiled program passes the string itself, as an opaque
 * `const NtsBorrowedString *`, and the callee reads it through
 * `nts_string_view`: the string's own code units, at the width it stores them,
 * with a length. Nothing is scanned, converted, copied or allocated on the way,
 * and U+0000 and lone surrogates are data -- the text crosses exactly, which
 * the UTF-8 crossing and `Utf16String` cannot promise.
 *
 * Standalone, and C++ as well as C, because the C that receives a view is
 * often not the runtime's: a C++ adapter reads one without the runtime header.
 *
 * **Borrowed for the call.** The units are valid until the function returns
 * and not after; C that wants the text later copies it. A literal is the
 * exception (`NTS_STRING_VIEW_IMMORTAL`): its units never move, so a host may
 * key a cache of its own conversion by their address. */

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NtsBorrowedString NtsBorrowedString;

/* The units are `uint16_t` (UTF-16 code units) rather than `uint8_t`
 * (Latin-1, one code unit per byte). */
#define NTS_STRING_VIEW_WIDE 1u
/* A literal: immortal, so its units have a stable address for the life of
 * the program. */
#define NTS_STRING_VIEW_IMMORTAL 2u

typedef struct NtsStringView {
  const void *units;
  uint32_t length;
  uint32_t flags;
} NtsStringView;

/* The string a view parameter received. A NULL string -- `StringView | null`
 * passed `null` -- is `{NULL, 0, 0}`. */
NtsStringView nts_string_view(const NtsBorrowedString *string);

#ifdef __cplusplus
}
#endif

#endif
