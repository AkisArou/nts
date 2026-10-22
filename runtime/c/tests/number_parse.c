/* `Number(s)` and `parseFloat(s)`: decimal text to the nearest double.
 *
 * The value of a span the runtime's grammar admits comes from ffc.h, a C99 port
 * of fast_float (`ffc/README.md`). Two kinds of check, each against something
 * other than the code under test:
 *
 *   - a differential with glibc's `strtod`, which is correctly rounded, over
 *     text the grammar admits: random doubles written every way a program
 *     writes them (shortest, every precision, fixed, a leading `+` or `.`,
 *     leading zeros, a trailing `.`, `E`), random digit strings with random
 *     exponents, and the cases that are hard for a fast parser -- halfway
 *     between two doubles, the subnormal boundary, past the largest double,
 *     and hundreds of digits;
 *   - the grammar, as node answers it: what JavaScript and C disagree about
 *     (`inf`, `.5`, `1e`, `0b101`, `-0x10`), whitespace, signs of zero, and
 *     `parseFloat`'s longest prefix.
 *
 * Wide strings are copied to bytes before they are read, so the differential
 * runs over both widths. */
#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nts_runtime.h"

static int failures;

static void check(const char *what, bool ok) {
  if (ok) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* The same double, bit for bit -- so `-0` is not `0` -- or both NaN. */
static bool same(double a, double b) {
  uint64_t a_bits;
  uint64_t b_bits;
  memcpy(&a_bits, &a, sizeof a_bits);
  memcpy(&b_bits, &b, sizeof b_bits);
  return a_bits == b_bits || (a != a && b != b);
}

/* `text` as a string of the width asked for: narrow, or the same units held two
 * bytes each, which a slice of a wide string can be. */
static NtsString *string_of(const char *text, bool wide) {
  const uint32_t length = (uint32_t)strlen(text);
  if (!wide) {
    return nts_string_from_utf8(text, length);
  }
  NtsString *out = nts_str_raw(length, 1);
  uint16_t *units = NTS_ELEMENTS(out, uint16_t);
  for (uint32_t at = 0; at < length; at++) {
    units[at] = (unsigned char)text[at];
  }
  units[length] = 0;
  return out;
}

static long differential_cases;
static long differential_disagree;
static long wide_cases;

/* `text`, which the grammar admits, read by both and compared bit for bit. */
static void differ(const char *text) {
  const double expected = strtod(text, NULL);
  for (int width = 0; width < 2; width++) {
    NtsString *s = string_of(text, width == 1);
    const double got = nts_str_to_number(s);
    const double prefix = nts_parse_float(s);
    if (width == 1 && (s->flags & NTS_TWO_BYTE) != 0) {
      wide_cases++;
    }
    nts_release(s);
    differential_cases++;
    if (!same(got, expected) || !same(prefix, expected)) {
      if (differential_disagree++ < 8) {
        printf("  %s: Number %a, parseFloat %a, strtod %a\n", text, got, prefix,
               expected);
      }
    }
  }
}

/* xorshift64*, seeded: the same samples every run. */
static uint64_t state = 0x2545f4914f6cdd1du;
static uint64_t next_bits(void) {
  state ^= state >> 12;
  state ^= state << 25;
  state ^= state >> 27;
  return state * 0x2545f4914f6cdd1du;
}

/* A random double written the ways a program writes one. */
static void written(double x) {
  char text[512];
  snprintf(text, sizeof text, "%.17g", x);
  differ(text);
  const int precision = (int)(next_bits() % 18u);
  snprintf(text, sizeof text, "%.*e", precision, x);
  differ(text);
  snprintf(text, sizeof text, "%.*E", precision, x);
  differ(text);
  if (fabs(x) < 1e30 && fabs(x) > 1e-30) {
    snprintf(text, sizeof text, "%.*f", (int)(next_bits() % 24u), x);
    differ(text);
  }
  snprintf(text, sizeof text, "+%.17g", fabs(x));
  differ(text);
  snprintf(text, sizeof text, "000%.15g", fabs(x));
  differ(text);
}

/* Random digits, a point somewhere or nowhere, an exponent or none. */
static void digits(void) {
  char text[128];
  size_t at = 0;
  if (next_bits() % 4u == 0) {
    text[at++] = '-';
  }
  const int count = 1 + (int)(next_bits() % 40u);
  const int point = (int)(next_bits() % (uint64_t)(count + 2)) - 1;
  for (int i = 0; i < count; i++) {
    if (i == point) {
      text[at++] = '.';
    }
    text[at++] = (char)('0' + next_bits() % 10u);
  }
  if (point == count) {
    text[at++] = '.';
  }
  if (next_bits() % 2u == 0) {
    at += (size_t)snprintf(text + at, sizeof text - at, "e%d",
                           (int)(next_bits() % 801u) - 400);
  }
  text[at] = '\0';
  differ(text);
}

static void expect_number(const char *text, double node) {
  NtsString *s = nts_string_from_utf8(text, (uint32_t)strlen(text));
  const double got = nts_str_to_number(s);
  nts_release(s);
  char what[160];
  snprintf(what, sizeof what, "Number(\"%s\") is %g", text, node);
  check(what, same(got, node));
}

static void expect_prefix(const char *text, double node) {
  NtsString *s = nts_string_from_utf8(text, (uint32_t)strlen(text));
  const double got = nts_parse_float(s);
  nts_release(s);
  char what[160];
  snprintf(what, sizeof what, "parseFloat(\"%s\") is %g", text, node);
  check(what, same(got, node));
}

int main(void) {
  /* The hard cases, as text. */
  static const char *hard[] = {
      "9007199254740993", /* 2^53 + 1: halfway, to even */
      "9007199254740993.0000000000000001",
      "9007199254740995", /* halfway, to even, upward */
      "1.7976931348623157e308",
      "1.7976931348623158e308", /* rounds to the largest */
      "1.7976931348623159e308", /* past it: Infinity */
      "2.2250738585072011e-308",
      "2.2250738585072012e-308",
      "2.2250738585072014e-308", /* the smallest normal */
      "4.9406564584124654e-324", /* the smallest subnormal */
      "2.4703282292062327e-324", /* just under half of it: zero */
      "2.4703282292062328e-324", /* just over: the smallest */
      "1e-400",
      "1e400",
      "0.1",
      "0.30000000000000004",
      "123456789012345678901234567890",
      "7.2911220195563975e-304",
      "3.0000000000000001",
      "1.00000000000000011102230246251565404236316680908203125",
      "1.00000000000000011102230246251565404236316680908203124",
      "1.00000000000000011102230246251565404236316680908203126",
      "0.000000000000000000000000000000000000000000000000000000000000000001",
  };
  for (size_t i = 0; i < sizeof hard / sizeof hard[0]; i++) {
    differ(hard[i]);
  }
  /* Eight hundred digits around the halfway point below 1. */
  {
    char text[900];
    text[0] = '0';
    text[1] = '.';
    for (int i = 2; i < 802; i++) {
      text[i] = '9';
    }
    text[802] = '\0';
    differ(text);
    text[801] = '5';
    differ(text);
  }
  const long hard_disagree = differential_disagree;
  check("the hard cases are read as strtod reads them", hard_disagree == 0);

  for (long n = 0; n < 400000; n++) {
    uint64_t bits = next_bits();
    double x;
    memcpy(&x, &bits, sizeof x);
    if (isfinite(x)) {
      written(x);
    }
    digits();
  }
  check("random doubles, every way they are written, read as strtod reads "
        "them",
        differential_disagree == hard_disagree);
  printf("     (%ld readings, %ld of them from wide strings)\n",
         differential_cases, wide_cases);
  check("the wide strings were wide", wide_cases * 2 > differential_cases / 2);

  /* As node answers them. */
  expect_number("", 0.0);
  expect_number("   ", 0.0);
  expect_number(" \t12\n ", 12.0);
  expect_number("1.", 1.0);
  expect_number(".5", 0.5);
  expect_number("+.5", 0.5);
  expect_number("-.5", -0.5);
  expect_number("00012", 12.0);
  expect_number("-0", -0.0);
  expect_number("-1e-400", -0.0);
  expect_number("1e400", INFINITY);
  expect_number("-1E+400", -INFINITY);
  expect_number("Infinity", INFINITY);
  expect_number("+Infinity", INFINITY);
  expect_number("-Infinity", -INFINITY);
  expect_number("0x10", 16.0);
  expect_number("0B101", 5.0);
  expect_number("0o17", 15.0);
  expect_number(".", NAN);
  expect_number("+", NAN);
  expect_number("e5", NAN);
  expect_number("1e", NAN);
  expect_number("1e+", NAN);
  expect_number("1_000", NAN);
  expect_number("-0x10", NAN);
  expect_number("0x1p3", NAN);
  expect_number("infinity", NAN);
  expect_number("inf", NAN);
  expect_number("nan", NAN);
  expect_number("NaN", NAN);
  expect_number("12px", NAN);
  expect_number("\xc2\xbd", NAN); /* U+00BD, narrow and not a digit */
  expect_prefix("3.14abc", 3.14);
  expect_prefix("1e", 1.0);
  expect_prefix("1e+", 1.0);
  expect_prefix(".5x", 0.5);
  expect_prefix("-.5e1z", -5.0);
  expect_prefix("  -0", -0.0);
  expect_prefix("Infinityx", INFINITY);
  expect_prefix("0x10", 0.0);
  expect_prefix("abc", NAN);
  expect_prefix("1e400", INFINITY);

  return failures ? 1 : 0;
}
