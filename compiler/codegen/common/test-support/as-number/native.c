#include <stddef.h>

size_t small(void) { return 42; }
size_t edge(void) { return (size_t)1 << 53; }
size_t big(void) { return (size_t)1 << 60; }
long low(void) { return -((long)1 << 60); }

/* 0: exactly 2^53 and -2^53; 1: 2^53 + 1; 2: -2^53 - 1. */
void visit(int which, void (*f)(size_t, long)) {
  if (which == 0) {
    f((size_t)1 << 53, -((long)1 << 53));
  } else if (which == 1) {
    f(((size_t)1 << 53) + 1, 0);
  } else {
    f((size_t)1 << 53, -((long)1 << 53) - 1);
  }
}
