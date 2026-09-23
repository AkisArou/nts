#include "text.h"

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
