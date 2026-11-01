/* Unicode case conversion: `toLowerCase` and `toUpperCase`.
 *
 * The data is `nts_unicode_tables.h`, generated at emission from the
 * compiler's Unicode model (UCD 17.0, the version the pinned node reports).
 * This file is the algorithm over it. It replaced quickjs-ng's `lre_case_conv`
 * with compiler-owned, deduplicated tables. Ordinary BMP entries combine
 * their XOR delta and mapping facts in the same two-level lookup.
 *
 * # The shapes, fastest first
 *
 * One-byte strings convert one byte at a time (ASCII by arithmetic, Latin-1
 * by a 256-entry table), apart from the three characters whose uppercase
 * leaves one byte. A two-byte string holding only ASCII narrows to one byte.
 * Everything else takes the general path: the two-level tables, with astral
 * characters in constant-delta ranges and the expansions (ß to SS, İ to
 * i + combining dot) in an exception list the table marks with a sentinel.
 *
 * # Unchanged text keeps its string
 *
 * Converting text that has nothing to convert is common -- sorting keys,
 * normalising what is already normal -- and node answers it with the same
 * string. So does this: each path first asks whether anything would change,
 * and if not, the input comes back retained, no allocation. The result is
 * owned (+1) either way; the compiler models that as `MakesOrRetains`, and a
 * region clone calls this only on text it made or immortal text, because the
 * retain is a count a count-free clone has no release for.
 *
 * Two passes rather than one, in the general case. Case conversion is not
 * length-preserving -- one code point can become three -- so the output
 * length is not known until it has been computed. Running the lookup twice
 * is cheaper than allocating three times the input and copying it down. The
 * first pass is also where "nothing would change" is answered. It records
 * the output width too, so the second pass writes the final allocation.
 *
 * No context but one. The default (locale-insensitive) conversion is
 * per-character except `Final_Sigma`: a capital sigma lowercases to the
 * final form ς when a cased character precedes it and none follows, skipping
 * case-ignorable characters on both sides. The context is read from the
 * *original* string, never from the partially converted output -- that is
 * what the UCD's own header for the condition says, and a sigma after a
 * character this pass changed is still after the character that was there. */

/* Before any system header, which is what a feature-test macro requires.
 * `nts_runtime.c` says the same for its own translation unit; this is a
 * second one and gets no benefit from that. */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
/* Darwin: see `nts_runtime.c`, which needs this for the same header. */
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
#define _DARWIN_C_SOURCE
#endif

#include "nts_unicode.h"
#include "nts_unicode_tables.h"

#include <stdio.h>
#include <stdlib.h>

/* The compiler emits each direction's Latin-1 table from the same UCD model.
 * Uppercase excludes the three inputs whose result leaves one byte before
 * reading this table. No runtime initialization or mutable table is needed. */

/* The answer when nothing would change: the input, retained. Owned (+1)
 * exactly as a fresh answer is -- see the file comment. */
static NtsString *nts_case_unchanged(const NtsString *s) {
  nts_retain((NtsHeader *)s);
  return (NtsString *)s;
}

/* Classify ASCII and conversion changes in one SIMD scan. The final vector
 * overlaps the previous one instead of reading beyond the string; OR reduction
 * makes repeated lanes harmless. Short strings use the same flags scalarly. */
typedef unsigned char NtsAsciiVector __attribute__((vector_size(16)));

static NtsAsciiVector nts_ascii_load(const unsigned char *bytes) {
  NtsAsciiVector value;
  memcpy(&value, bytes, sizeof(value));
  return value;
}

static NtsAsciiVector nts_ascii_letters(NtsAsciiVector bytes,
                                        unsigned char first) {
  return (NtsAsciiVector)((bytes - first) < (unsigned char)26);
}

static NtsAsciiVector nts_ascii_flags(NtsAsciiVector bytes,
                                      unsigned char first) {
  return (bytes & (unsigned char)0x80) |
         (nts_ascii_letters(bytes, first) & (unsigned char)1);
}

static unsigned char nts_ascii_state(const unsigned char *bytes,
                                     uint32_t length, int lower) {
  const unsigned char first = (unsigned char)(lower ? 'A' : 'a');
  if (length >= 16u) {
    NtsAsciiVector state = nts_ascii_flags(nts_ascii_load(bytes), first);
    uint32_t at = 16u;
    while (at + 16u <= length) {
      state |= nts_ascii_flags(nts_ascii_load(bytes + at), first);
      at += 16u;
    }
    if (at < length) {
      state |= nts_ascii_flags(nts_ascii_load(bytes + length - 16u), first);
    }
    uint64_t halves[2];
    memcpy(halves, &state, sizeof(state));
    uint64_t flags = halves[0] | halves[1];
    flags |= flags >> 32;
    flags |= flags >> 16;
    flags |= flags >> 8;
    return (unsigned char)flags;
  }
  unsigned char state = 0;
  for (uint32_t at = 0; at < length; at++) {
    const unsigned char byte = bytes[at];
    const unsigned char delta = (unsigned char)(byte - first);
    state |= (unsigned char)((byte & 0x80u) | (delta < 26u));
  }
  return state;
}

/* The three one-byte characters whose uppercase form is not one byte, asked
 * only of a string with a byte above ASCII (`nts_ascii_state`), where the C
 * library's vectorised search is the right way to ask. */
static int nts_upper_escapes(const unsigned char *bytes, uint32_t length) {
  return memchr(bytes, 0xB5, length) != NULL ||
         memchr(bytes, 0xDF, length) != NULL ||
         memchr(bytes, 0xFF, length) != NULL;
}

/* An ASCII letter's two cases differ in one bit, 0x20, and nothing else in
 * ASCII has a case, so ASCII converts by arithmetic: flip that bit where the
 * byte is a letter of the case being converted from. Clang vectorises it,
 * where the Latin-1 table it would otherwise read is one load per byte. */
static uint32_t nts_ascii_flip(uint32_t unit, int lower) {
  const uint32_t first = lower ? 'A' : 'a';
  return unit ^ ((uint32_t)(unit - first < 26u) << 5);
}

static void nts_ascii_case(unsigned char *restrict into,
                           const unsigned char *restrict from, uint32_t length,
                           int lower) {
  const unsigned char first = (unsigned char)(lower ? 'A' : 'a');
  uint32_t at = 0;
  while (at + 16u <= length) {
    const NtsAsciiVector bytes = nts_ascii_load(from + at);
    const NtsAsciiVector mapped =
        bytes ^ (nts_ascii_letters(bytes, first) & (unsigned char)0x20);
    memcpy(into + at, &mapped, sizeof(mapped));
    at += 16u;
  }
  if (at < length && length >= 16u) {
    const NtsAsciiVector bytes = nts_ascii_load(from + length - 16u);
    const NtsAsciiVector mapped =
        bytes ^ (nts_ascii_letters(bytes, first) & (unsigned char)0x20);
    memcpy(into + length - 16u, &mapped, sizeof(mapped));
  } else {
    for (; at < length; at++) {
      into[at] = (unsigned char)nts_ascii_flip(from[at], lower);
    }
  }
}

static uint32_t nts_latin1_first_change(const unsigned char *bytes,
                                        uint32_t length,
                                        const unsigned char *table) {
  for (uint32_t at = 0; at < length; at++) {
    if (table[bytes[at]] != bytes[at]) {
      return at;
    }
  }
  return length;
}

/* Whether a two-byte string holds only ASCII, and if so whether converting
 * it would change anything: one pass answering both, where the string that
 * is all ASCII and already in the asked case keeps itself (two-byte form
 * and all -- it is the same string value) instead of narrowing a copy. */
static int nts_two_byte_ascii(const NtsString *s, int lower, int *needed) {
  const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
  const uint32_t first = lower ? 'A' : 'a';
  uint32_t any = 0;
  for (uint32_t at = 0; at < s->length; at++) {
    if (units[at] >= 0x80u) {
      return 0;
    }
    any |= (uint32_t)(units[at] - first < 26u);
  }
  *needed = any != 0;
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

#ifdef __nts_UNICODE_LOWER
/* The code point ending just before `at`, and where it starts: the backward
 * twin of `nts_code_point_at`, for `Final_Sigma`'s look-behind (its only
 * caller, hence the guard). A lone low surrogate (or a high one with nothing
 * after it) is its own unit value, as forward. */
static uint32_t nts_code_point_before(const NtsString *s, uint32_t at,
                                      uint32_t *start) {
  *start = at - 1u;
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    return NTS_ELEMENTS(s, unsigned char)[at - 1u];
  }
  const uint16_t *units = NTS_ELEMENTS(s, uint16_t);
  uint32_t unit = units[at - 1u];
  if (unit >= 0xDC00u && unit <= 0xDFFFu && at >= 2u) {
    uint32_t high = units[at - 2u];
    if (high >= 0xD800u && high <= 0xDBFFu) {
      *start = at - 2u;
      return 0x10000u + ((high - 0xD800u) << 10) + (unit - 0xDC00u);
    }
  }
  return unit;
}
#endif

/* Write one code point as UTF-16, or count what it would take. */
static uint32_t nts_put_code_point(NtsString *into, uint32_t at, uint32_t c) {
  if (into && (into->flags & NTS_TWO_BYTE) == 0) {
    NTS_ELEMENTS(into, unsigned char)[at] = (unsigned char)c;
    return 1;
  }
  uint16_t *units = into ? NTS_ELEMENTS(into, uint16_t) : NULL;
  if (c >= 0x10000u) {
    if (into) {
      units[at] = (uint16_t)(0xD800u + ((c - 0x10000u) >> 10));
      units[at + 1u] = (uint16_t)(0xDC00u + ((c - 0x10000u) & 0x3FFu));
    }
    return 2;
  }
  if (into) {
    units[at] = (uint16_t)c;
  }
  return 1;
}

/* The low payload is an XOR delta or a model-proved exception-record index.
 * Stop bits carry context, surrogate and identity-page authority to the hot
 * kernels. The cold lookup ignores those bits after decoding the original
 * code point; a full exception directly selects its record, without a search.
 * Above the BMP the original constant-delta range representation remains. */
static int nts_case_lookup(const __nts_case_tables *tables, uint32_t c,
                           uint32_t out[3]) {
  if (c <= 0xFFFFu) {
    uint32_t x =
        tables->blocks[((uint32_t)tables->index[c >> 8] << 8) + (c & 0xFFu)];
    if ((x & __nts_CASE_FULL_EXCEPTION) == 0) {
      out[0] = c ^ (uint16_t)x;
      return 1;
    }
    const __nts_case_exception *record = &tables->exceptions[(uint16_t)x];
    for (uint32_t each = 0; each < record->length; each++) {
      out[each] = tables->exception_pool[record->offset + each];
    }
    return (int)record->length;
  }
  for (uint32_t each = 0; each < tables->range_count; each++) {
    if (c < tables->ranges[each].lo) {
      break;
    }
    if (c <= tables->ranges[each].hi) {
      out[0] = c + (uint32_t)tables->ranges[each].delta;
      return 1;
    }
  }
  out[0] = c;
  return 1;
}

#ifdef __nts_UNICODE_LOWER
/* Membership in a sorted list of inclusive ranges: `Cased` and
 * `Case_Ignorable`, the two properties `Final_Sigma` reads. A surrogate's
 * unit value is in neither (they are not characters), which is what makes a
 * lone surrogate break the context, as it should. */
static int nts_in_property(const __nts_property_range *ranges, uint32_t count,
                           uint32_t c) {
  uint32_t lo = 0;
  uint32_t hi = count;
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo) / 2u;
    if (c < ranges[mid].lo) {
      hi = mid;
    } else if (c > ranges[mid].hi) {
      lo = mid + 1u;
    } else {
      return 1;
    }
  }
  return 0;
}

static int nts_is_cased(uint32_t c) {
  return nts_in_property(__nts_case_cased_ranges, __nts_CASE_CASED_RANGES_COUNT,
                         c);
}

static int nts_is_case_ignorable(uint32_t c) {
  return nts_in_property(__nts_case_ignorable_ranges,
                         __nts_CASE_IGNORABLE_RANGES_COUNT, c);
}

/* `Final_Sigma`: the capital sigma at `at` (of `width` units) takes the
 * final form when a cased character precedes it and none follows, skipping
 * case-ignorable characters on both sides. Read from the original string,
 * never the output being built -- see the file comment. */
static int nts_is_final_sigma(const NtsString *s, uint32_t at, uint32_t width) {
  int before_cased = 0;
  uint32_t scan = at;
  while (scan > 0) {
    uint32_t start = scan;
    uint32_t c = nts_code_point_before(s, scan, &start);
    if (!nts_is_case_ignorable(c)) {
      before_cased = nts_is_cased(c);
      break;
    }
    scan = start;
  }
  if (!before_cased) {
    return 0;
  }
  scan = at + width;
  while (scan < s->length) {
    uint32_t next_width = 1;
    uint32_t c = nts_code_point_at(s, scan, &next_width);
    if (!nts_is_case_ignorable(c)) {
      return !nts_is_cased(c);
    }
    scan += next_width;
  }
  return 1;
}
#endif

/* The ordinary kernels have fixed source/output widths and a fixed direction.
 * Only the cold helpers decode code points or materialize an expansion. */
typedef struct NtsCaseCount {
  uint64_t units;
  uint32_t changed;
  uint32_t wide;
} NtsCaseCount;

typedef struct NtsCaseMapping {
  uint32_t point;
  uint32_t width;
  uint32_t values[3];
  int count;
} NtsCaseMapping;

static NtsCaseMapping nts_case_cold(const NtsString *s, uint32_t at,
                                    const __nts_case_tables *tables,
                                    int lower) {
#ifndef __nts_UNICODE_LOWER
  (void)lower;
#endif
  NtsCaseMapping mapped;
  mapped.width = 1;
  mapped.point = nts_code_point_at(s, at, &mapped.width);
#ifdef __nts_UNICODE_LOWER
  if (lower && mapped.point == 0x03a3u &&
      nts_is_final_sigma(s, at, mapped.width)) {
    mapped.values[0] = 0x03c2u;
    mapped.count = 1;
  } else
#endif
  {
    mapped.count = nts_case_lookup(tables, mapped.point, mapped.values);
  }
  return mapped;
}

static uint32_t nts_case_count_cold(const NtsString *s, uint32_t at,
                                    const __nts_case_tables *tables, int lower,
                                    NtsCaseCount *counted) {
  const NtsCaseMapping mapped = nts_case_cold(s, at, tables, lower);
  counted->changed |= mapped.count != 1 || mapped.values[0] != mapped.point;
  for (int each = 0; each < mapped.count; each++) {
    const uint32_t cp = mapped.values[each];
    counted->wide |= cp;
    counted->units += cp > 0xffffu ? 2u : 1u;
  }
  return mapped.width;
}

static uint32_t nts_case_write_cold(const NtsString *s, uint32_t at,
                                    const __nts_case_tables *tables, int lower,
                                    NtsString *into, uint32_t *written) {
  const NtsCaseMapping mapped = nts_case_cold(s, at, tables, lower);
  for (int each = 0; each < mapped.count; each++) {
    *written += nts_put_code_point(into, *written, mapped.values[each]);
  }
  return mapped.width;
}

static uint32_t nts_case_identity_scalar(const uint16_t *source, uint32_t at,
                                         uint32_t length, uint16_t lo,
                                         uint16_t hi, int lower) {
  const uint32_t first = lower ? 'A' : 'a';
  while (at < length) {
    const uint32_t cp = source[at];
    if (!((cp >= lo && cp <= hi) ||
          (cp < 128u && (uint32_t)(cp - first) >= 26u))) {
      break;
    }
    at++;
  }
  return at;
}

/* Clang lowers these operations to the target's vector ISA, including NEON.
 * memcpy permits unaligned input, and the length guard prevents tail loads.
 * The scalar tail is also the complete fallback on other C compilers. */
static uint32_t nts_case_identity_span(const uint16_t *source, uint32_t at,
                                       uint32_t length, uint16_t lo,
                                       uint16_t hi, int lower) {
#if defined(__clang__)
  typedef uint16_t Units __attribute__((vector_size(16)));
  const uint16_t first = lower ? 'A' : 'a';
  const Units starts = {first, first, first, first, first, first, first, first};
  const Units lows = {lo, lo, lo, lo, lo, lo, lo, lo};
  const Units highs = {hi, hi, hi, hi, hi, hi, hi, hi};
  const Units ascii_limit = {128, 128, 128, 128, 128, 128, 128, 128};
  const Units letters = {26, 26, 26, 26, 26, 26, 26, 26};
  while (length - at >= 8u) {
    Units units;
    memcpy(&units, source + at, sizeof(units));
    const Units ascii =
        (Units)(units < ascii_limit) & (Units)((units - starts) >= letters);
    const Units identity = (Units)(units >= lows) & (Units)(units <= highs);
    if (__builtin_reduce_and(ascii | identity) != UINT16_MAX) {
      break;
    }
    at += 8u;
  }
#endif
  return nts_case_identity_scalar(source, at, length, lo, hi, lower);
}

/* Every ordinary entry carries all count facts and one XOR delta. Per-unit
 * work is independent of how often code points change pages. The single stop
 * test leaves context, expansions, surrogates and whole identity-page scans
 * out of the scalar mapping loop. */
#define NTS_CASE_COUNT(NAME, TABLE, LOWER, SOURCE, TWO_BYTE)                   \
  static NtsCaseCount NAME(const NtsString *s) {                               \
    const SOURCE *restrict source = NTS_ELEMENTS(s, SOURCE);                   \
    const uint32_t length = s->length;                                         \
    const uint8_t *restrict index = (TABLE).index;                             \
    const uint32_t *restrict blocks = (TABLE).blocks;                          \
    NtsCaseCount counted = {0, 0, 0};                                          \
    uint32_t at = 0;                                                           \
    while (at < length) {                                                      \
      const uint32_t start = at;                                               \
      uint32_t facts = 0;                                                      \
      uint32_t entry = 0;                                                      \
      for (; at < length; at++) {                                              \
        const uint32_t cp = source[at];                                        \
        entry = blocks[((uint32_t)index[cp >> 8] << 8) | (cp & 255u)];         \
        if (entry & __nts_CASE_COUNT_STOP) {                                   \
          break;                                                               \
        }                                                                      \
        facts |= entry;                                                        \
      }                                                                        \
      counted.units += at - start;                                             \
      counted.changed |= (facts & 0xffffu) != 0;                               \
      counted.wide |= facts & __nts_CASE_WIDE;                                 \
      if (at == length) {                                                      \
        break;                                                                 \
      }                                                                        \
      if ((TWO_BYTE) && (entry & __nts_CASE_IDENTITY)) {                       \
        const uint32_t cp = source[at];                                        \
        const __nts_case_identity run = (TABLE).identity[cp >> 8];             \
        const uint32_t end = nts_case_identity_span(                           \
            (const uint16_t *)source, at, length, run.lo, run.hi, LOWER);      \
        counted.units += end - at;                                             \
        counted.wide |= cp;                                                    \
        at = end;                                                              \
        continue;                                                              \
      }                                                                        \
      at += nts_case_count_cold(s, at, &(TABLE), LOWER, &counted);             \
    }                                                                          \
    return counted;                                                            \
  }

#define NTS_CASE_WRITE(NAME, TABLE, LOWER, SOURCE, TWO_BYTE, OUTPUT)           \
  static void NAME(const NtsString *s, NtsString *out) {                       \
    const SOURCE *restrict source = NTS_ELEMENTS(s, SOURCE);                   \
    OUTPUT *restrict output = NTS_ELEMENTS(out, OUTPUT);                       \
    const uint32_t length = s->length;                                         \
    const uint8_t *restrict index = (TABLE).index;                             \
    const uint32_t *restrict blocks = (TABLE).blocks;                          \
    uint32_t at = 0;                                                           \
    uint32_t written = 0;                                                      \
    while (at < length) {                                                      \
      const uint32_t start = at;                                               \
      uint32_t entry = 0;                                                      \
      for (; at < length; at++) {                                              \
        const uint32_t cp = source[at];                                        \
        entry = blocks[((uint32_t)index[cp >> 8] << 8) | (cp & 255u)];         \
        if (entry & __nts_CASE_WRITE_STOP) {                                   \
          break;                                                               \
        }                                                                      \
        output[written + (at - start)] = (OUTPUT)(cp ^ entry);                 \
      }                                                                        \
      written += at - start;                                                   \
      if (at == length) {                                                      \
        break;                                                                 \
      }                                                                        \
      if ((TWO_BYTE) && (entry & __nts_CASE_IDENTITY)) {                       \
        const uint32_t cp = source[at];                                        \
        const __nts_case_identity run = (TABLE).identity[cp >> 8];             \
        const uint32_t end = nts_case_identity_span(                           \
            (const uint16_t *)source, at, length, run.lo, run.hi, LOWER);      \
        const uint32_t span = end - at;                                        \
        if (sizeof(SOURCE) == sizeof(OUTPUT)) {                                \
          memcpy(output + written, source + at,                                \
                 (size_t)span * sizeof(SOURCE));                               \
        } else {                                                               \
          for (uint32_t each = 0; each < span; each++) {                       \
            output[written + each] = (OUTPUT)source[at + each];                \
          }                                                                    \
        }                                                                      \
        written += span;                                                       \
        at = end;                                                              \
        continue;                                                              \
      }                                                                        \
      at += nts_case_write_cold(s, at, &(TABLE), LOWER, out, &written);        \
    }                                                                          \
  }

#define NTS_CASE_ROUTE(NAME, COUNT, WRITE8, WRITE16)                           \
  __attribute__((noinline)) static NtsString *NAME(const NtsString *s) {       \
    const NtsCaseCount counted = COUNT(s);                                     \
    if (!counted.changed) {                                                    \
      return nts_case_unchanged(s);                                            \
    }                                                                          \
    if (counted.units > (uint64_t)NTS_MAX_LENGTH) {                            \
      fprintf(stderr, NTS_REFUSED "a case-converted string is too long\n");    \
      abort();                                                                 \
    }                                                                          \
    NtsString *out =                                                           \
        nts_str_raw((uint32_t)counted.units, counted.wide > 255u);             \
    if (counted.wide > 255u) {                                                 \
      WRITE16(s, out);                                                         \
    } else {                                                                   \
      WRITE8(s, out);                                                          \
    }                                                                          \
    return out;                                                                \
  }

#define NTS_CASE_SHAPES(NAME, TABLE, LOWER)                                    \
  NTS_CASE_COUNT(NAME##_count8, TABLE, LOWER, uint8_t, 0)                      \
  NTS_CASE_COUNT(NAME##_count16, TABLE, LOWER, uint16_t, 1)                    \
  NTS_CASE_WRITE(NAME##_write8_8, TABLE, LOWER, uint8_t, 0, uint8_t)           \
  NTS_CASE_WRITE(NAME##_write8_16, TABLE, LOWER, uint8_t, 0, uint16_t)         \
  NTS_CASE_WRITE(NAME##_write16_8, TABLE, LOWER, uint16_t, 1, uint8_t)         \
  NTS_CASE_WRITE(NAME##_write16_16, TABLE, LOWER, uint16_t, 1, uint16_t)       \
  NTS_CASE_ROUTE(NAME##8, NAME##_count8, NAME##_write8_8, NAME##_write8_16)    \
  NTS_CASE_ROUTE(NAME##16, NAME##_count16, NAME##_write16_8, NAME##_write16_16)

#ifdef __nts_UNICODE_LOWER
NTS_CASE_SHAPES(nts_case_lower, __nts_case_lower_tables, 1)
#endif
#ifdef __nts_UNICODE_UPPER
NTS_CASE_SHAPES(nts_case_upper, __nts_case_upper_tables, 0)
#endif

#undef NTS_CASE_SHAPES
#undef NTS_CASE_ROUTE
#undef NTS_CASE_WRITE
#undef NTS_CASE_COUNT

/* Aligned, which is not a style choice. This function's predecessor compiled
 * to byte-identical code on two backends and ran 28% slower on one of them
 * purely from where it landed in a cache line -- branch-predictor aliasing,
 * unstable luck that flipped a published benchmark row 35% between runs with
 * no relevant change between them. Pinning the alignment took the luck out.
 * Only this one: the same attribute on `nts_release` measured nothing. */
__attribute__((aligned(64))) static NtsString *
nts_str_case_convert(const NtsString *s, const __nts_case_tables *tables,
                     int lower) {
  const uint32_t length = s->length;
  if ((s->flags & NTS_TWO_BYTE) == 0) {
    const unsigned char *restrict bytes = NTS_ELEMENTS(s, unsigned char);
    const unsigned char state = nts_ascii_state(bytes, length, lower);
    if ((state & 0x80u) == 0) {
      if ((state & 1u) == 0) {
        return nts_case_unchanged(s);
      }
      NtsString *out = nts_str_raw(length, 0);
      unsigned char *restrict into = NTS_ELEMENTS(out, unsigned char);
      nts_ascii_case(into, bytes, length, lower);
      return out;
    }
    if (lower || !nts_upper_escapes(bytes, length)) {
      const unsigned char *table = tables->latin1;
      const uint32_t first = nts_latin1_first_change(bytes, length, table);
      if (first == length) {
        return nts_case_unchanged(s);
      }
      NtsString *out = nts_str_raw(length, 0);
      unsigned char *restrict into = NTS_ELEMENTS(out, unsigned char);
      if (first > 0) {
        memcpy(into, bytes, first);
      }
      for (uint32_t at = first; at < length; at++) {
        into[at] = table[bytes[at]];
      }
      return out;
    }
    /* An uppercase that escapes one byte falls to the general path. */
  } else {
    int needed = 0;
    if (nts_two_byte_ascii(s, lower, &needed)) {
      if (!needed) {
        return nts_case_unchanged(s);
      }
      /* A two-byte string holding only ASCII, whose result is one byte. */
      const uint16_t *restrict units = NTS_ELEMENTS(s, uint16_t);
      NtsString *out = nts_str_raw(length, 0);
      unsigned char *restrict into = NTS_ELEMENTS(out, unsigned char);
      for (uint32_t at = 0; at < length; at++) {
        into[at] = (unsigned char)nts_ascii_flip(units[at], lower);
      }
      return out;
    }
  }

#if defined(__nts_UNICODE_LOWER) && defined(__nts_UNICODE_UPPER)
  if (lower) {
    return (s->flags & NTS_TWO_BYTE) ? nts_case_lower16(s) : nts_case_lower8(s);
  }
  return (s->flags & NTS_TWO_BYTE) ? nts_case_upper16(s) : nts_case_upper8(s);
#elif defined(__nts_UNICODE_LOWER)
  return (s->flags & NTS_TWO_BYTE) ? nts_case_lower16(s) : nts_case_lower8(s);
#else
  return (s->flags & NTS_TWO_BYTE) ? nts_case_upper16(s) : nts_case_upper8(s);
#endif
}

#ifdef __nts_UNICODE_LOWER
NtsString *nts_str_to_lower_case(const NtsString *s) {
  return nts_str_case_convert(s, &__nts_case_lower_tables, 1);
}
#endif

#ifdef __nts_UNICODE_UPPER
NtsString *nts_str_to_upper_case(const NtsString *s) {
  return nts_str_case_convert(s, &__nts_case_upper_tables, 0);
}
#endif
