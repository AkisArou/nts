#include "text.h"

#include <stdlib.h>
#include <string.h>

int text_length(const char *s) { return (int)strlen(s); }

int text_byte(const char *s, int at) {
  size_t length = strlen(s);
  if (at < 0 || (size_t)at >= length)
    return -1;
  return (unsigned char)s[at];
}

static unsigned total;

unsigned text_total(const char *s) {
  for (const unsigned char *p = (const unsigned char *)s; *p; p++)
    total += *p;
  return total;
}

int text_is_null(const char *s) { return s == NULL; }

const char *text_greek(void) { return "\xCE\xB1\xF0\x9F\x98\x80"; }

char *text_dup(const char *s) {
  size_t n = strlen(s) + 1;
  char *copy = malloc(n);
  if (copy != NULL)
    memcpy(copy, s, n);
  return copy;
}

const char *text_dup_unfreed(const char *s) { return text_dup(s); }

const char *text_maybe(int which) { return which == 0 ? NULL : "x"; }

const char *text_overlong(void) { return "\xC0\xAF"; }

const char *text_broken_promise(void) { return NULL; }
