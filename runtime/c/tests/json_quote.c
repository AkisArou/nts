/* JSON's quoted strings (`nts_json_quote`, `nts_json_first_escape`,
 * `nts_str_append_json_quoted` and its twin) against a reference written here
 * from `runtime/web-platform/src/json/text.ts` -- its `firstEscapeIndex` and
 * `quoteFromIndex`, one unit at a time, which is the specification the kernel
 * must agree with.
 *
 * The kernel reads 32 bytes, 16 wide units or eight bytes at a time, and reads
 * a short tail as the last whole step again, so the cases sit at those edges:
 * every escape at every position of strings from 1 to 70 units, narrow and
 * wide; a surrogate pair straddling a step, a lone half at either end of one;
 * and thousands of strings drawn from controls, Table 78's seven, `/`,
 * U+007F, Latin-1, wide units and surrogates, at every length from 0 to 100,
 * each with its first escape asked from every index. Then the appends' rules:
 * in place only into a grown string nobody else holds, a copy otherwise, the
 * twin leaving its receiver alone, widening, and a string quoted onto itself.
 *
 * `runtime_checkpoint` runs it twice under ASan and UBSan, built for
 * x86-64-v3 (AVX2) and for the baseline (the word and the unit loop), and
 * both builds must answer every check. */
#include <math.h>
#include <stdio.h>
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

/* --- The reference: text.ts, one unit at a time. --- */

/* `firstEscapeIndex(value, from)`, with `length` for its -1. */
static uint32_t reference_first(const uint16_t *units, uint32_t length,
                                uint32_t from) {
  for (uint32_t at = from; at < length; at++) {
    const uint16_t unit = units[at];
    if (unit > '\\' || (unit >= 0x20u && unit != '"' && unit != '\\')) {
      if (unit < 0xD800u || unit > 0xDFFFu) {
        continue;
      }
      if (unit <= 0xDBFFu && at + 1u < length) {
        const uint16_t next = units[at + 1u];
        if (next >= 0xDC00u && next <= 0xDFFFu) {
          at++;
          continue;
        }
      }
      return at;
    }
    return at;
  }
  return length;
}

/* `quoteJSONString(value)` into `out`, which holds 6 * length + 2 units; how
 * many it wrote. */
static uint32_t reference_quote(const uint16_t *units, uint32_t length,
                                uint16_t *out) {
  static const char hex[] = "0123456789abcdef";
  uint32_t into = 0;
  out[into++] = '"';
  uint32_t plain = 0;
  for (uint32_t at = reference_first(units, length, 0); at < length;
       at = reference_first(units, length, plain)) {
    while (plain < at) {
      out[into++] = units[plain++];
    }
    const uint16_t unit = units[at];
    const char *named = NULL;
    switch (unit) {
    case '"':
      named = "\\\"";
      break;
    case '\\':
      named = "\\\\";
      break;
    case '\n':
      named = "\\n";
      break;
    case '\r':
      named = "\\r";
      break;
    case '\t':
      named = "\\t";
      break;
    case '\b':
      named = "\\b";
      break;
    case '\f':
      named = "\\f";
      break;
    default:
      break;
    }
    if (named != NULL) {
      out[into++] = (unsigned char)named[0];
      out[into++] = (unsigned char)named[1];
    } else {
      out[into++] = '\\';
      out[into++] = 'u';
      out[into++] = (unsigned char)hex[unit >> 12];
      out[into++] = (unsigned char)hex[(unit >> 8) & 0xFu];
      out[into++] = (unsigned char)hex[(unit >> 4) & 0xFu];
      out[into++] = (unsigned char)hex[unit & 0xFu];
    }
    plain = at + 1u;
  }
  while (plain < length) {
    out[into++] = units[plain++];
  }
  out[into++] = '"';
  return into;
}

/* --- Strings. --- */

/* A string of these units: wide if `wide`, whatever they are, so the wide
 * kernel runs on ASCII too; narrow otherwise, every unit then a byte. */
static NtsString *made(const uint16_t *units, uint32_t length, int wide) {
  NtsString *s = nts_str_raw(length, wide);
  for (uint32_t i = 0; i < length; i++) {
    if (wide) {
      NTS_ELEMENTS(s, uint16_t)[i] = units[i];
    } else {
      NTS_ELEMENTS(s, unsigned char)[i] = (unsigned char)units[i];
    }
  }
  return s;
}

/* Whether `s` holds exactly these code units. */
static bool holds(const NtsString *s, const uint16_t *units, uint32_t length) {
  if (s->length != length) {
    return false;
  }
  for (uint32_t i = 0; i < length; i++) {
    if (nts_unit(s, i) != units[i]) {
      return false;
    }
  }
  return true;
}

/* Whether `s` holds this ASCII text. */
static bool says(const NtsString *s, const char *text) {
  const uint32_t length = (uint32_t)strlen(text);
  if (s->length != length) {
    return false;
  }
  for (uint32_t i = 0; i < length; i++) {
    if (nts_unit(s, i) != (unsigned char)text[i]) {
      return false;
    }
  }
  return true;
}

static NtsString *ascii(const char *text) {
  return nts_string_from_utf8(text, strlen(text));
}

/* A grown string holding `text` (at least two characters), with the room its
 * power of two leaves. */
static NtsString *grown(const char *text) {
  const size_t length = strlen(text);
  NtsString *s = nts_string_from_utf8(text, length - 1u);
  return nts_str_append_char_code(s, (double)(unsigned char)text[length - 1u]);
}

/* Whether these units agree with the reference: their first escape asked from
 * every index, their quoted form, and that form appended onto a string by both
 * entries. */
static bool agrees(const uint16_t *units, uint32_t length, int wide) {
  static uint16_t expected[6u * 128u + 2u];
  static uint16_t appended[6u * 128u + 4u];
  NtsString *s = made(units, length, wide);
  bool ok = true;
  for (uint32_t from = 0; from <= length; from++) {
    const uint32_t first = reference_first(units, length, from);
    const double answer = nts_json_first_escape(s, (double)from);
    ok = ok && answer == (first == length ? -1.0 : (double)first);
  }
  const uint32_t count = reference_quote(units, length, expected);
  NtsString *quoted = nts_json_quote(s);
  ok = ok && holds(quoted, expected, count) &&
       ((quoted->flags & NTS_TWO_BYTE) != 0) == (wide != 0);
  appended[0] = '<';
  appended[1] = '>';
  memcpy(appended + 2, expected, count * sizeof(uint16_t));
  NtsString *left = grown("<>");
  NtsString *onto = nts_str_concat_json_quoted(left, s);
  ok = ok && holds(onto, appended, count + 2u) && says(left, "<>");
  NtsString *into = nts_str_append_json_quoted(left, s);
  ok = ok && holds(into, appended, count + 2u);
  nts_release(into);
  nts_release(onto);
  nts_release(quoted);
  nts_release(s);
  return ok;
}

/* `text`, ASCII, quoted, and whether it reads `expected`. */
static bool quotes(const char *text, const char *expected) {
  NtsString *s = ascii(text);
  NtsString *quoted = nts_json_quote(s);
  const bool ok = says(quoted, expected);
  nts_release(quoted);
  nts_release(s);
  return ok;
}

/* These units, as a wide string, quoted, and whether it holds `expected`. */
static bool quotes_wide(const uint16_t *units, uint32_t length,
                        const uint16_t *expected, uint32_t count) {
  NtsString *s = made(units, length, 1);
  NtsString *quoted = nts_json_quote(s);
  const bool ok = holds(quoted, expected, count);
  nts_release(quoted);
  nts_release(s);
  return ok;
}

/* A deterministic draw, so a failure is the same failure on the next run. */
static uint64_t state = 0x9E3779B97F4A7C15ull;
static uint32_t draw(uint32_t below) {
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return (uint32_t)(state % below);
}

/* A unit, mostly a letter, sometimes one JSON text has something to say
 * about or one beside it. */
static uint16_t narrow_unit(void) {
  static const uint16_t edges[] = {0x00, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D,
                                   0x1F, 0x20, '"',  '\\', '/',  0x7F, 0x80,
                                   0xFF, 0x21, 0x23, 0x5B, 0x5D};
  if (draw(8) != 0) {
    return (uint16_t)('a' + draw(26));
  }
  return edges[draw(sizeof edges / sizeof edges[0])];
}

/* The same, with wide units and both halves of a surrogate among them. */
static uint16_t wide_unit(void) {
  static const uint16_t edges[] = {0xD800, 0xDBFF, 0xDC00, 0xDFFF, 0xD83D,
                                   0xDE00, 0x263A, 0x0100, 0xFFFF, 0xE000,
                                   0xD7FF, 0xF800, 0x1F,   '"',    '\\'};
  if (draw(4) != 0) {
    return narrow_unit();
  }
  return edges[draw(sizeof edges / sizeof edges[0])];
}

int main(void) {
  char what[160];

  /* Table 78 and 25.5.4.3, as text.ts's own test spells them. */
  check("Table 78: the five control characters it names",
        quotes("\b\t\n\f\r", "\"\\b\\t\\n\\f\\r\""));
  check("Table 78: a quote", quotes("\"", "\"\\\"\""));
  check("Table 78: a backslash", quotes("\\", "\"\\\\\""));
  check("no \\v: U+000B is \\u000b", quotes("\v", "\"\\u000b\""));
  check("U+001F is \\u001f, lowercase", quotes("\x1f", "\"\\u001f\""));
  check("a solidus is written bare", quotes("/", "\"/\""));
  check("U+007F and U+0020 are written bare", quotes("\x7f ", "\"\x7f \""));
  check("the empty string is two quotes", quotes("", "\"\""));
  check("a string needing nothing is itself in quotes",
        quotes("plain text, nothing to do", "\"plain text, nothing to do\""));
  {
    const uint16_t nul[] = {0};
    NtsString *s = made(nul, 1, 0);
    NtsString *quoted = nts_json_quote(s);
    check("U+0000 is \\u0000", says(quoted, "\"\\u0000\""));
    nts_release(quoted);
    nts_release(s);
  }
  {
    const uint16_t latin[] = {0xE9, 0xFF};
    NtsString *s = made(latin, 2, 0);
    NtsString *quoted = nts_json_quote(s);
    const uint16_t expected[] = {'"', 0xE9, 0xFF, '"'};
    check("Latin-1 is written bare and stays narrow",
          holds(quoted, expected, 4) && (quoted->flags & NTS_TWO_BYTE) == 0);
    nts_release(quoted);
    nts_release(s);
  }

  /* Surrogates: a pair as it stands, either half alone escaped. */
  {
    const uint16_t pair[] = {0xD83D, 0xDE00};
    const uint16_t pair_quoted[] = {'"', 0xD83D, 0xDE00, '"'};
    check("a surrogate pair is written as it stands",
          quotes_wide(pair, 2, pair_quoted, 4));
    const uint16_t lead[] = {0xD800};
    const uint16_t lead_quoted[] = {'"', '\\', 'u', 'd', '8', '0', '0', '"'};
    check("a lone lead is \\ud800", quotes_wide(lead, 1, lead_quoted, 8));
    const uint16_t trail[] = {0xDFFF};
    const uint16_t trail_quoted[] = {'"', '\\', 'u', 'd', 'f', 'f', 'f', '"'};
    check("a lone trail is \\udfff", quotes_wide(trail, 1, trail_quoted, 8));
    const uint16_t lead_a[] = {0xD800, 'a'};
    const uint16_t lead_a_quoted[] = {'"', '\\', 'u', 'd', '8',
                                      '0', '0',  'a', '"'};
    check("a lead before a non-trail is escaped",
          quotes_wide(lead_a, 2, lead_a_quoted, 9));
    const uint16_t reversed[] = {0xDC00, 0xD800};
    const uint16_t reversed_quoted[] = {'"',  '\\', 'u', 'd', 'c', '0', '0',
                                        '\\', 'u',  'd', '8', '0', '0', '"'};
    check("a trail before a lead is two escapes",
          quotes_wide(reversed, 2, reversed_quoted, 14));
  }

  /* Each escape at each position, narrow and wide, from 1 to 70 units: every
   * edge of the 8-, 16- and 32-unit steps and of their overlapping tails.
   * Then each with the unit after it that a borrowing has-a-zero-byte test
   * would flag too -- a space after a control, `#` after `"`, `]` after `\`
   * -- which the scan, resuming just past the escape, must not report. */
  {
    static const uint16_t escapes[] = {0x00, 0x08, 0x0A, 0x1F, '"', '\\'};
    static const uint16_t beside[] = {0x20, 0x20, 0x20, 0x20, '#', ']'};
    static uint16_t units[70];
    for (int wide = 0; wide <= 1; wide++) {
      bool alone = true;
      bool neighboured = true;
      for (uint32_t length = 1; length <= 70; length++) {
        for (uint32_t at = 0; at < length; at++) {
          for (size_t e = 0; e < sizeof escapes / sizeof escapes[0]; e++) {
            for (uint32_t i = 0; i < length; i++) {
              units[i] = (uint16_t)('a' + i % 26u);
            }
            units[at] = escapes[e];
            alone = alone && agrees(units, length, wide);
            if (at + 1u < length) {
              units[at + 1u] = beside[e];
              neighboured = neighboured && agrees(units, length, wide);
            }
          }
        }
      }
      snprintf(what, sizeof what,
               "%s: each escape at each position of 1 to 70 units",
               wide ? "wide" : "narrow");
      check(what, alone);
      snprintf(what, sizeof what,
               "%s: the unit after an escape is not one by borrowing from it",
               wide ? "wide" : "narrow");
      check(what, neighboured);
    }
  }

  /* A wide unit or a surrogate at each position of a wide string, alone and
   * as a pair, which straddles each step's edge somewhere. */
  {
    static uint16_t units[70];
    bool lone = true;
    bool paired = true;
    bool bare = true;
    for (uint32_t length = 1; length <= 70; length++) {
      for (uint32_t at = 0; at < length; at++) {
        for (uint32_t i = 0; i < length; i++) {
          units[i] = (uint16_t)('a' + i % 26u);
        }
        units[at] = 0xD800;
        lone = lone && agrees(units, length, 1);
        units[at] = 0xDC00;
        lone = lone && agrees(units, length, 1);
        units[at] = 0x263A;
        bare = bare && agrees(units, length, 1);
        if (at + 1u < length) {
          units[at] = 0xD83D;
          units[at + 1u] = 0xDE00;
          paired = paired && agrees(units, length, 1);
          units[at] = 0xDE00;
          units[at + 1u] = 0xD83D;
          lone = lone && agrees(units, length, 1);
        }
      }
    }
    check("wide: a lone surrogate at each position of 1 to 70 units", lone);
    check("wide: a surrogate pair at each position, straddling each step",
          paired);
    check("wide: a wide unit at each position is written bare", bare);
  }

  /* Drawn strings, every length from 0 to 100, every first escape asked. */
  {
    static uint16_t units[100];
    bool narrow_ok = true;
    bool wide_ok = true;
    for (int round = 0; round < 40; round++) {
      for (uint32_t length = 0; length <= 100; length++) {
        for (uint32_t i = 0; i < length; i++) {
          units[i] = narrow_unit();
        }
        narrow_ok = narrow_ok && agrees(units, length, 0);
        for (uint32_t i = 0; i < length; i++) {
          units[i] = wide_unit();
        }
        wide_ok = wide_ok && agrees(units, length, 1);
      }
    }
    check("narrow: 4040 drawn strings of 0 to 100 units", narrow_ok);
    check("wide: 4040 drawn strings of 0 to 100 units", wide_ok);
  }

  /* `nts_json_first_escape` at the ends of its range. */
  {
    NtsString *s = ascii("ab\"cd");
    check("first escape: from the start", nts_json_first_escape(s, 0) == 2.0);
    check("first escape: from past it", nts_json_first_escape(s, 3) == -1.0);
    check("first escape: from the length", nts_json_first_escape(s, 5) == -1.0);
    check("first escape: from past the length",
          nts_json_first_escape(s, 9) == -1.0);
    check("first escape: from NaN, which the loop's guard stops",
          nts_json_first_escape(s, NAN) == -1.0);
    nts_release(s);
  }

  /* The appends' rules. */
  {
    NtsString *x = ascii("x\n");
    NtsString *room = grown("abcde");
    NtsString *in_place = nts_str_append_json_quoted(room, x);
    check("append: a grown string with room is written in place",
          in_place == room && says(in_place, "abcde\"x\\n\""));
    nts_release(in_place);

    NtsString *tight = ascii("abc");
    NtsString *copied = nts_str_append_json_quoted(tight, x);
    check("append: an exact-sized string grows into a copy",
          says(copied, "abc\"x\\n\"") && (copied->flags & NTS_GROWN) != 0);
    nts_release(copied);

    NtsString *shared = grown("abcde");
    nts_retain(shared);
    NtsString *apart = nts_str_append_json_quoted(shared, x);
    check("append: a string held twice is copied, the other holder's "
          "unchanged",
          apart != shared && says(apart, "abcde\"x\\n\"") &&
              says(shared, "abcde"));
    nts_release(apart);
    nts_release(shared);

    NtsString *kept = grown("abcde");
    NtsString *fresh = nts_str_concat_json_quoted(kept, x);
    check("concat: a grown string with room is left as it was",
          fresh != kept && says(fresh, "abcde\"x\\n\"") && says(kept, "abcde"));
    nts_release(fresh);
    nts_release(kept);

    const uint16_t smile[] = {0x263A};
    NtsString *wide = made(smile, 1, 1);
    NtsString *widened = nts_str_append_json_quoted(grown("<>"), wide);
    const uint16_t expected[] = {'<', '>', '"', 0x263A, '"'};
    check("append: a wide string widens a narrow one",
          holds(widened, expected, 5) && (widened->flags & NTS_TWO_BYTE) != 0);
    NtsString *onto_wide = nts_str_append_json_quoted(widened, x);
    const uint16_t both[] = {'<', '>', '"',  0x263A, '"',
                             '"', 'x', '\\', 'n',    '"'};
    check("append: a narrow string onto a wide one is written as wide units",
          holds(onto_wide, both, 10));
    nts_release(onto_wide);
    nts_release(wide);
    nts_release(x);
  }

  /* A string quoted onto itself: read whole before it is written. */
  {
    NtsString *self = grown("a\"b\x01");
    NtsString *same = nts_str_append_json_quoted(self, self);
    check("append: itself, in place",
          same == self && says(same, "a\"b\x01\"a\\\"b\\u0001\""));
    nts_release(same);
    NtsString *tight = ascii("a\"b");
    NtsString *copy = nts_str_append_json_quoted(tight, tight);
    check("append: itself, through a copy", says(copy, "a\"b\"a\\\"b\""));
    nts_release(copy);
  }

  printf("%s\n", failures ? "FAILED" : "json quote checks passed");
  return failures ? 1 : 0;
}
