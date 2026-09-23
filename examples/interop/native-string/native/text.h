// A C library that reports what it received as a `const char *`, so the
// caller can compare bytes rather than trust a round trip that might undo its
// own mistake.
#ifndef NTS_TEXT_H
#define NTS_TEXT_H

#include <stddef.h>
// `free`, which releases what `text_dup` returns: a library declares the
// function that frees its results in the header that returns them.
#include <stdlib.h>

// strlen, as C sees it.
int text_length(const char *s);
// The byte at `at`, or -1 past the end.
int text_byte(const char *s, int at);
// A running total of every byte ever received, so a loop of calls has
// something observable that the optimiser cannot drop.
unsigned text_total(const char *s);

// 1 when C received NULL, 0 when it received a string.
int text_is_null(const char *s);

// Strings the other way: returned by C.
// "α😀", borrowed: C keeps it.
const char *text_greek(void);
// A fresh malloc'd copy of `s`, which the caller frees.
char *text_dup(const char *s);
// The same, for the control arm: declared without the free, so each call
// leaks, and the leak arm must see it.
const char *text_dup_unfreed(const char *s);
// NULL for 0, and "x" otherwise.
const char *text_maybe(int which);
// NULL, from a function whose binding promises a string: the arm that must
// stop the process rather than make a null of a `string`.
const char *text_broken_promise(void);
// The overlong encoding of '/', which must not decode to '/'.
const char *text_overlong(void);

#endif
