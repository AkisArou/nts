/* `String(n)` in radix 10: the shortest digits that read back as the double,
 * placed by ECMAScript's Number::toString.
 *
 * The digits come from zmij (`zmij/README.md`). Three things are checked over
 * every sample, each against something other than the code under test:
 *
 *   - the text is byte for byte what the specification gives for that many
 *     digits: the C library's correctly rounded `%.*e` of the double at the
 *     digit count written -- the closest decimal of that length, which is the
 *     one Number::toString picks -- placed by the specification's thresholds,
 *     written out below a second time rather than shared with the runtime;
 *   - it reads back as the same double (`strtod`);
 *   - it is the shortest that does: one significant digit fewer, correctly
 *     rounded, reads back as some other double.
 *
 * Together they are the whole of the rule: the closest digits, as few as read
 * back, laid out as the specification says. Until QuickJS's `dtoa.c` was
 * removed the first check compared with `js_dtoa`'s free format, which is not
 * shortest on some powers of two: `2^-1007` is `7.2911220195563975e-304` to it
 * and `7.291122019556398e-304` to node, zmij and the specification.
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

/* `s`, `length` digits, moved by one in its last place (`by` is 1 or -1).
 * False where that needs another digit or loses its first. */
static bool step(char *s, int length, int by) {
  for (int at = length - 1; at >= 0; at--) {
    const int digit = s[at] - '0' + by;
    if (digit >= 0 && digit <= 9) {
      s[at] = (char)('0' + digit);
      return s[0] != '0';
    }
    s[at] = by > 0 ? '0' : '9';
  }
  return false;
}

/* Whether the digits `s` with the point at `n` read back as `magnitude`. */
static bool reads_back(const char *s, int length, int n, double magnitude) {
  char text[64];
  snprintf(text, sizeof text, "%c.%.*se%d", s[0], length - 1, s + 1, n - 1);
  return strtod(text, NULL) == magnitude;
}

/* Number::toString(x) for a finite, nonzero `x` written with `k` significant
 * digits, from the specification (its steps 5 to 10).
 *
 * The digits `s` and the point `n`: of the `k`-digit decimals that read back
 * as `x`, the closest to it. That is the C library's correctly rounded `%.*e`
 * wherever it reads back -- and one step from it where it does not, which
 * happens at a power of two: the double below is half as far away as the one
 * above, so the closest decimal can fall outside the narrower side and the
 * closest one that reads back is its neighbour on the wider side. `2^-1007`
 * is `7.291122019556398e-304` (node, and this), not the correctly rounded
 * `...397`, which reads back as another double.
 *
 * Then the four layouts and their thresholds -- every digit and zeros up to
 * 21 places, the point inside the digits, `0.` and up to six zeros, or an
 * exponent. */
static void specified(double x, int k, char *out) {
  const double magnitude = fabs(x);
  char scientific[64];
  snprintf(scientific, sizeof scientific, "%.*e", k - 1, magnitude);
  char s[32];
  int length = 0;
  const char *at = scientific;
  for (; *at != 'e'; at++) {
    if (*at != '.') {
      s[length++] = *at;
    }
  }
  const int n = (int)strtol(at + 1, NULL, 10) + 1;
  if (!reads_back(s, length, n, magnitude)) {
    for (int by = 1; by >= -1; by -= 2) {
      char moved[32];
      memcpy(moved, s, (size_t)length);
      if (step(moved, length, by) && reads_back(moved, length, n, magnitude)) {
        memcpy(s, moved, (size_t)length);
        break;
      }
    }
  }
  char *q = out;
  if (x < 0) {
    *q++ = '-';
  }
  if (length <= n && n <= 21) {
    memcpy(q, s, (size_t)length);
    q += length;
    memset(q, '0', (size_t)(n - length));
    q += n - length;
  } else if (0 < n && n <= 21) {
    memcpy(q, s, (size_t)n);
    q += n;
    *q++ = '.';
    memcpy(q, s + n, (size_t)(length - n));
    q += length - n;
  } else if (-6 < n && n <= 0) {
    *q++ = '0';
    *q++ = '.';
    memset(q, '0', (size_t)-n);
    q += -n;
    memcpy(q, s, (size_t)length);
    q += length;
  } else {
    *q++ = s[0];
    if (length > 1) {
      *q++ = '.';
      memcpy(q, s + 1, (size_t)(length - 1));
      q += length - 1;
    }
    q += sprintf(q, "e%c%d", n - 1 < 0 ? '-' : '+', abs(n - 1));
  }
  *q = '\0';
}

static long disagree_with_specification;
static long no_round_trip;
static long not_shortest;

static void sample(double x) {
  char text[64];
  formatted(x, text);
  if (!isfinite(x)) {
    return;
  }
  /* `-0` is `"0"` in ECMAScript, and the layout above would sign it. */
  if (x != 0) {
    char expected[64];
    specified(x, significant(text), expected);
    if (strcmp(text, expected) != 0 && disagree_with_specification++ < 5) {
      printf("  %a: zmij %s, the specification %s\n", x, text, expected);
    }
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
  const long boundary_disagree = disagree_with_specification;
  const long boundary_round_trip = no_round_trip;
  const long boundary_shortest = not_shortest;
  check("the boundary set is written as the specification lays it out",
        boundary_disagree == 0);
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
  check("three million random doubles are written as the specification lays "
        "them out",
        disagree_with_specification == boundary_disagree);
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
