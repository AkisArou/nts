/* Unicode case conversion, which is a table rather than an algorithm.
 *
 * Declared apart from `nts_runtime.h` because the implementation is apart:
 * `nts_unicode.c` reads the generated `nts_unicode_tables.h` (the compiler's
 * UCD 17.0 model, printed at emission), and both are emitted only for a
 * program that calls one of these. Linking them unconditionally takes
 * `examples/hello` from 81 KB to 162 KB, which is a doubling to carry tables
 * the program never reads.
 *
 * `toLowerCase` and `toUpperCase` are the whole surface for now. The locale
 * forms are deliberately absent rather than aliased: `toLocaleLowerCase` in
 * Turkish is a different answer for `I`, and answering it with the
 * locale-independent mapping would be wrong rather than approximate. */
#ifndef NTS_UNICODE_H
#define NTS_UNICODE_H

#include "nts_runtime.h"

NtsString *nts_str_to_lower_case(const NtsString *s);
NtsString *nts_str_to_upper_case(const NtsString *s);

#endif
