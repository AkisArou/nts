/* `String(n)` in radix 10: the shortest digits that read back as the double,
 * placed by ECMAScript's Number::toString.
 *
 * The digits come from zmij (`zmij/README.md`). Three things are checked over
 * every sample, each against something other than the code under test:
 *
 *   - the text is byte for byte what `js_dtoa` writes in its free format,
 *     QuickJS's exact bignum algorithm, which `String(n)` fell back to before
 *     zmij -- or shorter, where `js_dtoa` is not shortest. On some powers of
 *     two, whose lower neighbour is half as far away as the upper, it writes
 *     seventeen digits where sixteen read back: `2^-1007` is
 *     `7.2911220195563975e-304` to it and `7.291122019556398e-304` to node
 *     and zmij, and ECMAScript asks for the shortest;
 *   - it reads back as the same double (`strtod`);
 *   - it is the shortest that does: one significant digit fewer, correctly
 *     rounded, reads back as some other double.
 *
 * The samples are a boundary set -- where the layout switches between fixed
 * and exponent (1e21, 1e-7), the integers around 2^53 where the shortcut
 * stops, the extremes, every power of two and of ten and their neighbours --
 * and a few million random bit patterns, which reach subnormals, NaNs and both
 * signs. Then the edge cases node was asked about, spelled as node answers. */
#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nts_runtime.h"
#include "quickjs/dtoa.h"

static int failures;

static void check(const char *what, bool ok) {
  if (ok) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* `x` as `String(x)` writes it, NUL-terminated in `out`. */
static size_t formatted(double x, char *out) {
  NtsString *text = nts_number_to_string(x);
  const size_t length = text->length;
  memcpy(out, NTS_ELEMENTS(text, unsigned char), length);
  out[length] = '\0';
  nts_release(text);
  return length;
}

/* The significant digits of a formatted number: its mantissa without the
 * sign, the point, leading zeros or trailing ones. */
static int significant(const char *text) {
  int digits = 0;
  int trailing = 0;
  bool started = false;
  for (const char *at = text; *at != '\0' && *at != 'e'; at++) {
    if (*at < '0' || *at > '9') {
      continue;
    }
    if (*at == '0' && !started) {
      continue;
    }
    started = true;
    digits++;
    trailing = *at == '0' ? trailing + 1 : 0;
  }
  return digits - trailing;
}

static long disagree_with_dtoa;
/* Where `js_dtoa` wrote more digits than the shortest that reads back. */
static long dtoa_longer;
static long no_round_trip;
static long not_shortest;

static void sample(double x) {
  char text[64];
  formatted(x, text);
  /* `-0` is `"0"` in ECMAScript; `js_dtoa` is not asked about it. */
  if (x != 0) {
    char exact[JS_DTOA_MAX_DIGITS + 32];
    JSDTOATempMem scratch;
    const int length = js_dtoa(
        exact, x, 10, 0, JS_DTOA_FORMAT_FREE | JS_DTOA_EXP_AUTO, &scratch);
    exact[length] = '\0';
    if (strcmp(text, exact) != 0) {
      if (significant(text) < significant(exact) && strtod(text, NULL) == x) {
        dtoa_longer++;
      } else if (disagree_with_dtoa++ < 5) {
        printf("  %a: zmij %s, js_dtoa %s\n", x, text, exact);
      }
    }
  }
  if (!isfinite(x)) {
    return;
  }
  if (strtod(text, NULL) != x) {
    if (no_round_trip++ < 5) {
      printf("  %a: %s reads back as %a\n", x, text, strtod(text, NULL));
    }
  }
  const int digits = significant(text);
  if (digits > 1) {
    char shorter[64];
    snprintf(shorter, sizeof shorter, "%.*e", digits - 2, x);
    if (strtod(shorter, NULL) == x) {
      if (not_shortest++ < 5) {
        printf("  %a: %s, and %s reads back too\n", x, text, shorter);
      }
    }
  }
}

static void around(double x) {
  sample(x);
  sample(-x);
  sample(nextafter(x, INFINITY));
  sample(nextafter(x, -INFINITY));
}

/* xorshift64*, seeded: the same samples every run. */
static uint64_t state = 0x9e3779b97f4a7c15u;
static uint64_t next_bits(void) {
  state ^= state >> 12;
  state ^= state << 25;
  state ^= state >> 27;
  return state * 0x2545f4914f6cdd1du;
}

static void expect(double x, const char *node) {
  char text[64];
  formatted(x, text);
  char what[128];
  snprintf(what, sizeof what, "String(%.17g) is %s", x, node);
  check(what, strcmp(text, node) == 0);
  if (strcmp(text, node) != 0) {
    printf("  wrote %s\n", text);
  }
}

int main(void) {
  /* The boundary set. */
  around(1e21);
  around(1e-7);
  around(1e-6);
  around(9007199254740992.0); /* 2^53 */
  around(9007199254740991.0);
  around(4294967296.0); /* 2^32 */
  around(2147483648.0); /* 2^31 */
  around(DBL_MAX);
  around(DBL_MIN);
  around(5e-324);
  around(0.1 + 0.2);
  for (int power = -1074; power <= 1023; power++) {
    around(ldexp(1.0, power));
  }
  for (int power = -323; power <= 308; power++) {
    char literal[16];
    snprintf(literal, sizeof literal, "1e%d", power);
    around(strtod(literal, NULL));
  }
  const long boundary_disagree = disagree_with_dtoa;
  const long boundary_round_trip = no_round_trip;
  const long boundary_shortest = not_shortest;
  check("the boundary set is written as js_dtoa writes it, or shorter",
        boundary_disagree == 0);
  printf("     (%ld where js_dtoa is not shortest)\n", dtoa_longer);
  check("the boundary set reads back", boundary_round_trip == 0);
  check("the boundary set is the shortest that reads back",
        boundary_shortest == 0);

  /* A few million random bit patterns. */
  for (long at = 0; at < 3000000; at++) {
    uint64_t bits = next_bits();
    double x;
    memcpy(&x, &bits, sizeof x);
    sample(x);
  }
  check("three million random doubles are written as js_dtoa writes them, "
        "or shorter",
        disagree_with_dtoa == boundary_disagree);
  printf("     (%ld in all where js_dtoa is not shortest)\n", dtoa_longer);
  check("three million random doubles read back",
        no_round_trip == boundary_round_trip);
  check("three million random doubles are the shortest that read back",
        not_shortest == boundary_shortest);

  /* As node writes them. */
  expect(-0.0, "0");
  expect(0.0, "0");
  expect(5e-324, "5e-324");
  expect(DBL_MAX, "1.7976931348623157e+308");
  expect(1e21, "1e+21");
  expect(999999999999999900000.0, "999999999999999900000");
  expect(123456789012345680000.0, "123456789012345680000");
  expect(1e-7, "1e-7");
  expect(-1e-7, "-1e-7");
  expect(1.234e-7, "1.234e-7");
  expect(1e-6, "0.000001");
  expect(0.000001234, "0.000001234");
  expect(0.1 + 0.2, "0.30000000000000004");
  expect(9007199254740991.0, "9007199254740991");
  expect(9007199254740992.0, "9007199254740992");
  expect(9007199254740994.0, "9007199254740994");
  expect(-9007199254740993.0, "-9007199254740992");
  expect(4.35, "4.35");
  expect(1e300, "1e+300");
  expect(ldexp(1.0, -1007), "7.291122019556398e-304");
  expect(-ldexp(1.0, -957), "-8.209073602596753e-289");
  expect(NAN, "NaN");
  expect(INFINITY, "Infinity");
  expect(-INFINITY, "-Infinity");

  return failures ? 1 : 0;
}
