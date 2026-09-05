/* Six contracts the runtime states and did not keep.
 *
 * Every check here is a regression of a defect an external audit found at
 * `ce2b57a` and this file reproduced against the real runtime before the
 * repair. They are grouped because they share a shape rather than a subject:
 * each is a promise the header or a comment makes, kept by a line somewhere
 * else, with nothing asking whether the two still agree.
 *
 * Four of the six are *undefined behaviour* rather than wrong answers, which is
 * why the suite is built with UndefinedBehaviorSanitizer and why a machine that
 * happens to print the right characters is not evidence. A sweep of every power
 * of two through the formatter against node found no wrong digits at all while
 * `nts_number_to_string` was converting NaN to `int32_t` on the way in.
 *
 * The seventh mode, `abort`, is separate because it is expected to abort: it
 * asks for the one bigint value that must be refused, and a refusal is a
 * message and a call to `abort`, not a return.
 */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "nts_runtime.h"

static int failures;
static int checks;

static void ok(const char *what, int holds) {
  checks++;
  if (holds) {
    printf("ok %s\n", what);
    return;
  }
  printf("FAIL %s\n", what);
  failures++;
}

static NtsValue string_value(NtsString *s) {
  NtsValue v;
  v.tag = NTS_TAG_STRING;
  v.as.reference = (NtsHeader *)s;
  return v;
}

/* A retain must not change what a string *is*.
 *
 * `NtsString` is a typedef of `NtsHeader`, so a string's representation flags
 * and the collector's colour live in the same word. They used to live in the
 * same two *bits*: `nts_retain` blackens by clearing `NTS_COLOR_MASK`, which
 * cleared `NTS_TWO_BYTE`, and a retained wide string read back as the low byte
 * of each of its units. `"Ω"` became `"©"`. */
static void representation_survives_a_retain(void) {
  const uint16_t units[] = {0x03a9};
  NtsString *s = nts_str_alloc(units, 1);
  ok("a wide string is wide", (s->flags & NTS_TWO_BYTE) != 0);
  nts_retain((NtsHeader *)s);
  ok("and is still wide after a retain", (s->flags & NTS_TWO_BYTE) != 0);
  ok("and still reads its own code unit",
     NTS_ELEMENTS(s, uint16_t)[0] == 0x03a9);
  nts_release((NtsHeader *)s);
  nts_release((NtsHeader *)s);
}

/* A walk sees entries appended after it started, and `clear` is an append
 * point like any other.
 *
 * `nts_map_clear` used to reset `used` to zero, which puts the next insertion
 * at a slot a cursor already past it can never reach. Walking `[1, 2]`,
 * clearing after the first element and adding `3` must yield `[1, 3]`. */
static void a_cursor_survives_a_clear(void) {
  NtsMap *set = nts_set_new(NTS_KEY_NUMBER);
  nts_set_add(set, nts_value_of_number(1));
  nts_set_add(set, nts_value_of_number(2));

  double first = nts_map_next(set, 0);
  NtsValue seen = nts_map_key_at(set, first);
  ok("the walk starts at the first entry", nts_value_number(seen) == 1);
  nts_value_release(seen);

  nts_map_clear(set);
  nts_set_add(set, nts_value_of_number(3));

  double second = nts_map_next(set, first + 1);
  ok("an entry appended after a clear is reachable", second >= 0);
  seen = nts_map_key_at(set, second);
  ok("and it is the one that was appended", nts_value_number(seen) == 3);
  nts_value_release(seen);
  ok("and the walk then ends", nts_map_next(set, second + 1) == -1);
  nts_release((NtsHeader *)set);
}

/* Keeping `used` means the slots stay in the collector's way, so `clear` has
 * to empty them rather than only release them. A slot still naming a released
 * object is a reference a trace would follow into freed memory. */
static void a_clear_empties_the_slots_it_keeps(void) {
  const uint16_t units[] = {'x'};
  NtsString *s = nts_str_alloc(units, 1);
  NtsMap *map = nts_map_new(NTS_KEY_NUMBER);
  nts_map_set(map, nts_value_of_number(1), string_value(s));
  ok("the map holds the value", s->reserved == 2);

  nts_map_clear(map);
  ok("a clear gives it back", s->reserved == 1);

  int stale = 0;
  for (uint32_t at = 0; at < map->used; at++) {
    if (NTS_TAG_IS_REFERENCE(nts_value_tag(map->keys[at])) ||
        (map->values && NTS_TAG_IS_REFERENCE(nts_value_tag(map->values[at])))) {
      stale = 1;
    }
  }
  ok("and leaves no slot naming a released object", !stale);

  nts_collect_cycles();
  nts_map_clear(map);
  ok("and clearing an empty map gives nothing back twice", s->reserved == 1);
  nts_release((NtsHeader *)map);
  nts_release((NtsHeader *)s);
}

/* A read that retains is not a read.
 *
 * `nts_map_get`, `nts_map_key_at` and `nts_map_value_at` return an owned
 * reference, and all three were declared `pure`. `pure` licenses the optimizer
 * to keep one result and drop the other call -- so two owned reads became one
 * retain, and releasing both credits ended one below where it started. Clang at
 * -O2 does exactly that across translation units. */
static void two_owned_reads_take_two_credits(void) {
  const uint16_t units[] = {'x'};
  NtsString *s = nts_str_alloc(units, 1);
  NtsMap *map = nts_map_new(NTS_KEY_NUMBER);
  NtsValue key = nts_value_of_number(7);
  nts_map_set(map, key, string_value(s));
  ok("the map holds the value", s->reserved == 2);

  NtsValue a = nts_map_get(map, key);
  NtsValue b = nts_map_get(map, key);
  ok("both reads find it", nts_value_reference(a) == (NtsHeader *)s &&
                               nts_value_reference(b) == (NtsHeader *)s);
  ok("and both took a credit", s->reserved == 4);
  nts_value_release(a);
  nts_value_release(b);
  ok("which giving both back returns exactly", s->reserved == 2);

  nts_release((NtsHeader *)map);
  nts_release((NtsHeader *)s);
}

/* `BigInt.asIntN(0.5, v)` is a width of zero after `ToIndex` truncates, and
 * the signed path shifts by `width - 1`. Zero bits of anything is zero. */
static void a_fractional_width_below_one_is_zero(void) {
  volatile double bits = 0.5;
  ok("half a bit is no bits", nts_bigint_as_intn(bits, 1) == 0);
}

/* The bigint interval is closed on the left and open on the right, because
 * two's complement is asymmetric: `-2^127` is the least signed 128-bit integer
 * and `+2^127` is one past the greatest. The endpoint used to be accepted and
 * then converted, which is undefined. */
static void the_bigint_boundary_is_asymmetric(void) {
  volatile double low = -0x1p127;
  volatile double high = nextafter(0x1p127, 0.0);
  ok("the negative endpoint converts", nts_bigint_from_number(low) < 0);
  ok("the last double below 2^127 converts", nts_bigint_from_number(high) > 0);
  int all = 1;
  for (unsigned width = 1; width < 128; width++) {
    if (nts_bigint_as_intn(width, -1) != -1) {
      all = 0;
    }
  }
  ok("and every width reads -1 back as -1", all);
}

/* The formatter's integer fast path tested its candidate *after* converting to
 * `int32_t`. Its own comment says NaN and the infinities are expected to arrive
 * and fall through -- and converting either is undefined before the test that
 * would reject it runs. */
static void the_formatter_never_converts_what_it_cannot(void) {
  volatile double cases[] = {NAN,   INFINITY, -INFINITY,
                             1e100, -1e100,   2147483648.0};
  int all = 1;
  for (unsigned at = 0; at < sizeof(cases) / sizeof(cases[0]); at++) {
    NtsString *s = nts_number_to_string(cases[at]);
    if (!s || s->length == 0) {
      all = 0;
    }
    if (s) {
      nts_release((NtsHeader *)s);
    }
  }
  ok("every number outside int32 still formats", all);
}

int main(int argc, char **argv) {
  /* Its own mode, because it is expected to abort. */
  if (argc == 2 && strcmp(argv[1], "abort") == 0) {
    volatile double past = 0x1p127;
    (void)nts_bigint_from_number(past);
    fputs("FAIL 2^127 was converted rather than refused\n", stderr);
    return 1;
  }

  representation_survives_a_retain();
  a_cursor_survives_a_clear();
  a_clear_empties_the_slots_it_keeps();
  two_owned_reads_take_two_credits();
  a_fractional_width_below_one_is_zero();
  the_bigint_boundary_is_asymmetric();
  the_formatter_never_converts_what_it_cannot();

  printf("%d check(s), %d failure(s)\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
