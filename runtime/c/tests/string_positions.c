#include "nts_test_host.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

static void check(int ok) {
  if (!ok) {
    fputs("string position mismatch\n", stderr);
    exit(1);
  }
}
int main(void) {
  NtsString *s = nts_string_from_utf8("ababa", 5);
  NtsString *a = nts_string_from_utf8("a", 1);
  NtsString *empty = nts_string_from_utf8("", 0);
  double positions[] = {-INFINITY, -10.0, -1.9, -0.0, NAN,     0.9,
                        1.9,       2.9,   4.9,  5.0,  INFINITY};
  int starts[] = {1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0};
  int ends[] = {0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1};
  int index[] = {0, 0, 0, 0, 0, 0, 2, 2, 4, -1, -1};
  int last[] = {0, 0, 0, 0, 4, 0, 0, 2, 4, 4, 4};
  for (unsigned i = 0; i < sizeof(positions) / sizeof(*positions); ++i) {
    double p = positions[i];
    check(nts_str_starts_with_at(s, a, p) == starts[i]);
    check(nts_str_ends_with_at(s, a, p) == ends[i]);
    check(nts_str_index_of_from(s, a, p) == index[i]);
    check(nts_str_includes_from(s, a, p) == (index[i] >= 0));
    check(nts_str_last_index_of_from(s, a, p) == last[i]);
    check(nts_str_starts_with_at(s, empty, p));
    check(nts_str_ends_with_at(s, empty, p));
  }
  /* Node: s = "\u0100a\ud83d\ude00aba"; indices are code units, including
   * either half of the surrogate pair. These exercise wide/wide, wide/narrow,
   * and narrow/wide independently of the source compiler. */
  NtsString *wide = nts_string_from_utf8("\304\200a\360\237\230\200aba", 10);
  NtsString *pair = nts_string_from_utf8("\360\237\230\200", 4);
  NtsString *high = nts_string_from_char_code(0xD83D);
  NtsString *low = nts_string_from_char_code(0xDE00);
  check(nts_str_index_of_from(wide, a, 2.9) == 4);
  check(nts_str_last_index_of_from(wide, a, 3.9) == 1);
  check(nts_str_last_index_of_from(wide, a, INFINITY) == 6);
  check(nts_str_index_of_from(wide, pair, 2) == 2);
  check(nts_str_index_of_from(wide, pair, 3) == -1);
  check(nts_str_last_index_of_from(wide, pair, 1) == -1);
  check(nts_str_last_index_of_from(wide, pair, 2) == 2);
  check(nts_str_starts_with_at(wide, low, 3));
  check(nts_str_ends_with_at(wide, high, 3));
  check(nts_str_includes_from(wide, low, 3));
  check(!nts_str_includes_from(wide, low, 4));
  check(nts_str_index_of_from(s, pair, 0) == -1);
  check(nts_str_last_index_of_from(s, pair, INFINITY) == -1);
  check(nts_str_index_of_from(wide, empty, 3.9) == 3);
  check(nts_str_last_index_of_from(wide, empty, 3.9) == 3);
  check(nts_str_last_index_of_from(wide, empty, NAN) == 7);
  check(nts_str_index_of_from(s, empty, 2.9) == 2);
  check(nts_str_last_index_of_from(s, empty, 2.9) == 2);
  puts("string positions agree");
  return 0;
}
