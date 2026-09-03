/* The nts side of Unicode case conversion.
 *
 * The tables and `lre_case_conv` come from quickjs-ng and are included below
 * rather than compiled beside: several places build a program and each names
 * its `.c` files explicitly, so a second translation unit would need all of
 * them to agree. The `quickjs/` path is the repository's own, mirrored into the
 * emitted directory so this resolves in both.
 *
 * Two passes rather than one, in the general case. Case conversion is not
 * length-preserving -- `ß` uppercases to `SS`, `ﬁ` to `FI`, and one code point
 * can become three -- so the output length is not known until it has been
 * computed. Running the table lookup twice is cheaper than allocating three
 * times the input and copying it down.
 *
 * The one-byte path skips both, and that is nearly every call. */

/* Before any system header, which is what a feature-test macro requires.
 * quickjs-ng's `cutils.h` reaches for `clock_gettime`, `readlink` and
 * `pthread_condattr_setclock`, and the differential compiles with `-std=c11`.
 * `nts_runtime.c` says the same for its own translation unit; this is a second
 * one and gets no benefit from that. */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif

#include "nts_unicode.h"

/* Vendored code is held to upstream's warning standard, not ours, and the
 * pragmas are pushed and popped around it so that everything below is still
 * compiled with all of them on. */
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wsign-compare"
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-but-set-variable"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wimplicit-fallthrough"
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wcast-qual"
#pragma GCC diagnostic ignored "-Wunused-macros"
#endif
/* Including a `.c` is deliberate and not a slip: see `nts_runtime.c` for why
 * these must not become translation units of their own. */
/* NOLINTNEXTLINE(bugprone-suspicious-include) */
#include "quickjs/libunicode.c"
#if defined(__clang__) || defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

/* `lre_case_conv`'s third argument, spelled out. quickjs-ng passes a bare `0`
 * or `1` and calls the parameter `to_lower`, which reads as a boolean until the
 * folding case appears. */
#define NTS_CASE_UPPER 0
#define NTS_CASE_LOWER 1

/* Lowercasing a one-byte string never leaves one byte.
 *
 * Latin-1's uppercase letters are 0xC0..0xDE without 0xD7, and each maps 32
 * higher into 0xE0..0xFE -- so the whole of `toLowerCase` on a one-byte string
 * is this table and no test at all. Uppercasing is *not* closed, which is why
 * it does not get the same treatment: `\u00b5` becomes `\u039c`, `\u00ff`
 * becomes `\u0178`, and `\u00df` becomes two characters. Those three are found
 * with `memchr` rather than with a test per byte.
 *
 * # A table, and the arithmetic that lost to it
 *
 * Three forms were measured on `case-convert`, which is 128 conversions of a
 * 44-byte ASCII string:
 *
 *     two comparisons and a branch per byte      8.64 us
 *     this table                                 4.79 us
 *     branchless arithmetic, no table            7.26 us
 *
 * The arithmetic form was written on the theory that `table[bytes[at]]` is a
 * gather clang cannot vectorise, while comparisons and adds are sixteen bytes
 * per instruction. The theory was wrong and the number said so twice -- once
 * with `&&`, and again with `&` after the short-circuit was blamed for it.
 *
 * What it missed: 256 bytes stays in L1, so the table is *one load* per byte
 * with no dependency chain, where the arithmetic is two range tests, an or, a
 * shift and an add. For strings this size the instruction count decides and
 * the vector width never gets a chance. */
static unsigned char nts_latin1_lower[256];
static unsigned char nts_latin1_upper[256];
static int nts_tables_built = 0;

static void nts_build_tables(void) {
  if (nts_tables_built) {
    return;
  }
  for (int c = 0; c < 256; c++) {
    nts_latin1_lower[c] = (unsigned char)c;
    nts_latin1_upper[c] = (unsigned char)c;
  }
  for (int c = 'A'; c <= 'Z'; c++) {
    nts_latin1_lower[c] = (unsigned char)(c + 32);
  }
  for (int c = 'a'; c <= 'z'; c++) {
    nts_latin1_upper[c] = (unsigned char)(c - 32);
  }
  for (int c = 0xC0; c <= 0xDE; c++) {
    if (c != 0xD7) {
      nts_latin1_lower[c] = (unsigned char)(c + 32);
    }
  }
  for (int c = 0xE0; c <= 0xFE; c++) {
    if (c != 0xF7) {
      nts_latin1_upper[c] = (unsigned char)(c - 32);
    }
  }
  nts_tables_built = 1;
}

/* The three one-byte characters whose uppercase form is not one byte.
 *
 * Every one of them is above ASCII, so a string with no high byte has none of
 * them -- and that is what ordinary text is. Ruling the whole question out with
 * one OR-reduce, which vectorises, beats three `memchr` calls looking for
 * characters that are not there: on `benches/cases/case-convert` those three
 * passes over a forty-five byte string were 7.3% of the program.
 *
 * The `memchr`s stay for the case that reaches them, where the C library's
 * vectorised search is still the right way to ask. */
static int nts_upper_escapes(const unsigned char *bytes, uint32_t length) {
  unsigned char high = 0;
  for (uint32_t at = 0; at < length; at++) {
    high |= bytes[at];
  }
  if ((high & 0x80u) == 0) {
    return 0;
  }
  return memchr(bytes, 0xB5, length) != NULL ||
         memchr(bytes, 0xDF, length) != NULL ||
         memchr(bytes, 0xFF, length) != NULL;
}

/* Whether every unit is ASCII, which decides whether the general path runs. */
static int nts_all_ascii(const NtsString *s) {
  if ((s->flags & NTS_TWO_BYTE) != 0) {
    const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
    for (uint32_t at = 0; at < s->length; at++) {
      if (units[at] >= 0x80u) {
        return 0;
      }
    }
    return 1;
  }
  const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
  for (uint32_t at = 0; at < s->length; at++) {
    if (bytes[at] >= 0x80u) {
      return 0;
    }
  }
  return 1;
}

/* The code point at `at`, and how many units it took.
 *
 * A high surrogate followed by a low one is one code point of two units. A
 * lone surrogate is left exactly as it is: it is not a character, it has no
 * case, and replacing it here would be this function deciding something
 * `toWellFormed` exists to decide. */
static uint32_t nts_code_point_at(const NtsString *s, uint32_t at,
                                  uint32_t *width) {
  *width = 1;
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    return NTS_ELEMENTS(s, unsigned char)[at];
  }
  const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
  uint32_t unit = units[at];
  if (unit >= 0xD800u && unit <= 0xDBFFu && at + 1u < s->length) {
    uint32_t low = units[at + 1u];
    if (low >= 0xDC00u && low <= 0xDFFFu) {
      *width = 2;
      return 0x10000u + ((unit - 0xD800u) << 10) + (low - 0xDC00u);
    }
  }
  return unit;
}

/* Write one code point as UTF-16, or count what it would take. */
static uint32_t nts_put_code_point(uint16_t *into, uint32_t at, uint32_t c) {
  if (c >= 0x10000u) {
    if (into) {
      into[at] = (uint16_t)(0xD800u + ((c - 0x10000u) >> 10));
      into[at + 1u] = (uint16_t)(0xDC00u + ((c - 0x10000u) & 0x3FFu));
    }
    return 2;
  }
  if (into) {
    into[at] = (uint16_t)c;
  }
  return 1;
}

/* One pass: fill `into` when it is given, and return the length either way. */
static uint32_t nts_case_pass(const NtsString *s, int conv_type,
                              uint16_t *into) {
  uint32_t out = 0;
  for (uint32_t at = 0; at < s->length;) {
    uint32_t width = 1;
    uint32_t c = nts_code_point_at(s, at, &width);
    at += width;
    uint32_t converted[LRE_CC_RES_LEN_MAX];
    int count = lre_case_conv(converted, c, conv_type);
    for (int each = 0; each < count; each++) {
      out += nts_put_code_point(into, out, converted[each]);
    }
  }
  return out;
}

/* Aligned, which is not a style choice and is the largest single number in
 * `benches/cases/case-convert`.
 *
 * The two backends emitted *byte-identical* code for this function -- 492
 * instructions, 96 of them vector, the same in both -- and one ran 28% slower
 * than the other. The only difference was where it landed: 0x4eb0 against
 * 0x4ed0, forty-eight bytes into a cache line against sixteen. Same
 * instructions, three times the branch mispredictions, from thirty-two bytes of
 * address.
 *
 * That is branch-predictor aliasing, and it is luck. It is also *unstable*
 * luck: an unrelated change to the runtime moved this function and flipped
 * which backend was faster, which is how a published row swung 35% between two
 * runs with no relevant change between them. Pinning the alignment takes the
 * luck out, and both backends land on the good side of it -- 3.36us and 2.63us
 * became 2.54 and 2.49.
 *
 * Only this one. The same attribute on `nts_release` measured nothing and is
 * not here; a hot function whose misprediction rate is already low has no
 * aliasing to lose. */
__attribute__((aligned(64))) static NtsString *
nts_str_case_convert(const NtsString *s, int conv_type) {
  nts_build_tables();

  /* One byte in, one byte out, one allocation, one pass.
   *
   * No pre-scan: for lowercasing there is nothing to find out, and for
   * uppercasing the only three characters that would escape one byte are found
   * with `memchr`, which the C library vectorises. */
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    const unsigned char *bytes = NTS_ELEMENTS(s, unsigned char);
    if (conv_type == NTS_CASE_LOWER || !nts_upper_escapes(bytes, s->length)) {
      const unsigned char *table =
          conv_type == NTS_CASE_LOWER ? nts_latin1_lower : nts_latin1_upper;
      NtsString *out = nts_str_raw(s->length, 0);
      unsigned char *into = NTS_ELEMENTS(out, unsigned char);
      for (uint32_t at = 0; at < s->length; at++) {
        into[at] = table[bytes[at]];
      }
      return out;
    }
  } else if (nts_all_ascii(s)) {
    /* A two-byte string holding only ASCII, whose result is one byte. */
    const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
    const unsigned char *table =
        conv_type == NTS_CASE_LOWER ? nts_latin1_lower : nts_latin1_upper;
    NtsString *out = nts_str_raw(s->length, 0);
    unsigned char *into = NTS_ELEMENTS(out, unsigned char);
    for (uint32_t at = 0; at < s->length; at++) {
      into[at] = table[(unsigned char)units[at]];
    }
    return out;
  }

  uint32_t length = nts_case_pass(s, conv_type, NULL);
  uint16_t *units = (uint16_t *)malloc((size_t)length * sizeof(uint16_t) + 2u);
  if (!units) {
    return nts_str_alloc(NULL, 0);
  }
  nts_case_pass(s, conv_type, units);
  NtsString *out = nts_str_alloc(units, length);
  free(units);
  return out;
}

NtsString *nts_str_to_lower_case(const NtsString *s) {
  return nts_str_case_convert(s, NTS_CASE_LOWER);
}

NtsString *nts_str_to_upper_case(const NtsString *s) {
  return nts_str_case_convert(s, NTS_CASE_UPPER);
}
