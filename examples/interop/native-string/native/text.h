// A C library that reports what it received as a `const char *`, so the
// caller can compare bytes rather than trust a round trip that might undo its
// own mistake.
#ifndef NTS_TEXT_H
#define NTS_TEXT_H

#include <stddef.h>

// strlen, as C sees it.
int text_length(const char *s);
// The byte at `at`, or -1 past the end.
int text_byte(const char *s, int at);
// A running total of every byte ever received, so a loop of calls has
// something observable that the optimiser cannot drop.
unsigned text_total(const char *s);

#endif
