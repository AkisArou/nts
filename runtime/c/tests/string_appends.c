/* The appends that write a number, a unit or a slice into the string they
 * extend (`nts_str_append_number`, `_at`, `_char_at`, `_char_code`,
 * `_slice`), each against what the string it replaces would have read.
 *
 * Every consuming helper is run on five receivers, because each is a
 * different promise about whether the append may write where it is:
 *
 *   - a grown string with room, one reference: written in place, the same
 *     pointer back;
 *   - an exact-sized string, one reference: no room, so a grown copy;
 *   - a grown string somebody else also holds (count two): a copy, and the
 *     string the other holder sees unchanged;
 *   - a grown string a table lookup has hashed, one reference: hashing settles
 *     a string and gives up its room, so a copy, never a write under a kept
 *     hash;
 *   - a table's key, hashed and held twice: a copy, and the key still found.
 *
 * Each non-consuming twin (`nts_str_concat_*`) leaves even a unique string
 * with room as it was. Then each helper's own rules: a number's text as
 * `String(n)` writes it, the index rules of `s[i]` and `charAt`,
 * `fromCharCode`'s conversion, `slice`'s bounds, a wide unit or slice widening
 * a narrow string and an all-narrow slice of a wide one keeping it narrow, and
 * a slice of the string being appended to, in place and through a copy. */
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

static NtsString *exact(const char *text) {
  return nts_string_from_utf8(text, strlen(text));
}

/* A grown string holding `text` (at least one character), with room. */
static NtsString *grown(const char *text) {
  const size_t length = strlen(text);
  NtsString *s = nts_string_from_utf8(text, length - 1u);
  return nts_str_append_char_code(s, (double)(unsigned char)text[length - 1u]);
}

static NtsValue as_key(NtsString *s) {
  return nts_value_of_reference((NtsHeader *)s, NTS_TAG_STRING);
}

/* One helper, applied to a receiver and what it should then hold. */
typedef NtsString *(*Append)(NtsString *a);

/* The five receivers, for one helper that appends `tail` onto `"abc"`. */
static void receivers(const char *name, Append append, const char *tail) {
  char what[160];
  char expected[64];
  snprintf(expected, sizeof expected, "abc%s", tail);

  NtsString *room = grown("abc");
  NtsString *in_place = append(room);
  snprintf(what, sizeof what,
           "%s: a grown string with room is written in place", name);
  check(what, in_place == room && says(in_place, expected));
  nts_release(in_place);

  NtsString *tight = exact("abc");
  NtsString *copied = append(tight);
  snprintf(what, sizeof what, "%s: an exact-sized string grows into a copy",
           name);
  check(what, says(copied, expected) && (copied->flags & NTS_GROWN) != 0);
  nts_release(copied);

  NtsString *shared = grown("abc");
  nts_retain(shared);
  NtsString *apart = append(shared);
  snprintf(what, sizeof what,
           "%s: a string held twice is copied and the other holder's is "
           "unchanged",
           name);
  check(what, apart != shared && says(apart, expected) && says(shared, "abc"));
  nts_release(apart);
  nts_release(shared);

  NtsMap *table = nts_map_new(NTS_KEY_STRING);
  NtsString *key = exact("abc");
  nts_map_set(table, as_key(key), nts_value_of_number(1));
  NtsString *probe = grown("abc");
  bool found = nts_map_has(table, as_key(probe));
  NtsString *after_hash = append(probe);
  snprintf(what, sizeof what,
           "%s: a string a lookup hashed is copied, not written under its hash",
           name);
  check(what, found && says(after_hash, expected));
  nts_release(after_hash);

  NtsString *held_key = grown("abc");
  NtsMap *keyed = nts_map_new(NTS_KEY_STRING);
  nts_map_set(keyed, as_key(held_key), nts_value_of_number(2));
  NtsString *from_key = append(held_key);
  NtsString *again = exact("abc");
  snprintf(what, sizeof what,
           "%s: a table's key is copied and the key is still found", name);
  check(what, from_key != held_key && says(from_key, expected) &&
                  nts_map_has(keyed, as_key(again)));
  nts_release(from_key);
  nts_release(again);
  nts_release(key);
  nts_release(&table->header);
  nts_release(&keyed->header);
}

/* The non-consuming twin of one helper, on two receivers that the consuming
 * one would write or replace: a grown string with room and one reference, and
 * an exact-sized one. Each is left as it was, and the answer is a string of
 * its own. */
static void twin_receivers(const char *name, Append twin, const char *tail) {
  char what[160];
  char expected[64];
  snprintf(expected, sizeof expected, "abc%s", tail);

  NtsString *room = grown("abc");
  NtsString *fresh = twin(room);
  snprintf(what, sizeof what,
           "%s twin: a grown string with room is left as it was", name);
  check(what, fresh != room && says(fresh, expected) && says(room, "abc"));
  nts_release(fresh);
  nts_release(room);

  NtsString *tight = exact("abc");
  NtsString *copy = twin(tight);
  snprintf(what, sizeof what,
           "%s twin: an exact-sized string is left as it was", name);
  check(what, copy != tight && says(copy, expected) && says(tight, "abc"));
  nts_release(copy);
  nts_release(tight);
}

static NtsString *append_number(NtsString *a) {
  return nts_str_append_number(a, 1.5);
}

static NtsString *text_xyz;

static NtsString *append_at(NtsString *a) {
  return nts_str_append_at(a, text_xyz, 1);
}

static NtsString *append_char_at(NtsString *a) {
  return nts_str_append_char_at(a, text_xyz, 2);
}

static NtsString *append_char_code(NtsString *a) {
  return nts_str_append_char_code(a, 'q');
}

static NtsString *append_slice(NtsString *a) {
  return nts_str_append_slice(a, text_xyz, -2, 3);
}

static NtsString *concat_number(NtsString *a) {
  return nts_str_concat_number(a, 1.5);
}

static NtsString *concat_at(NtsString *a) {
  return nts_str_concat_at(a, text_xyz, 1);
}

static NtsString *concat_char_at(NtsString *a) {
  return nts_str_concat_char_at(a, text_xyz, 2);
}

static NtsString *concat_char_code(NtsString *a) {
  return nts_str_concat_char_code(a, 'q');
}

static NtsString *concat_slice(NtsString *a) {
  return nts_str_concat_slice(a, text_xyz, -2, 3);
}

/* `"<"` with `append` applied once, as text. */
static bool appends(NtsString *(*apply)(NtsString *), const char *text) {
  NtsString *out = apply(grown("<"));
  bool ok = says(out, text);
  nts_release(out);
  return ok;
}

static double number_case;
static NtsString *with_number(NtsString *a) {
  return nts_str_append_number(a, number_case);
}

static bool number_reads(double n, const char *text) {
  number_case = n;
  char expected[64];
  snprintf(expected, sizeof expected, "<%s", text);
  return appends(with_number, expected);
}

static double index_case;
static NtsString *with_char_at(NtsString *a) {
  return nts_str_append_char_at(a, text_xyz, index_case);
}

static bool char_at_reads(double at, const char *text) {
  index_case = at;
  char expected[16];
  snprintf(expected, sizeof expected, "<%s", text);
  return appends(with_char_at, expected);
}

static double from_case;
static double to_case;
static NtsString *with_slice(NtsString *a) {
  return nts_str_append_slice(a, text_xyz, from_case, to_case);
}

static bool slice_reads(double from, double to, const char *text) {
  from_case = from;
  to_case = to;
  char expected[16];
  snprintf(expected, sizeof expected, "<%s", text);
  return appends(with_slice, expected);
}

int main(void) {
  text_xyz = exact("xyz");

  receivers("number", append_number, "1.5");
  receivers("s[i]", append_at, "y");
  receivers("charAt", append_char_at, "z");
  receivers("fromCharCode", append_char_code, "q");
  receivers("slice", append_slice, "yz");

  twin_receivers("number", concat_number, "1.5");
  twin_receivers("s[i]", concat_at, "y");
  twin_receivers("charAt", concat_char_at, "z");
  twin_receivers("fromCharCode", concat_char_code, "q");
  twin_receivers("slice", concat_slice, "yz");
  {
    NtsString *room = grown("abc");
    NtsString *outside = nts_str_concat_char_at(room, text_xyz, 9);
    NtsString *empty = nts_str_concat_slice(room, text_xyz, 2, 1);
    check("twins: appending nothing answers a copy of its own",
          outside != room && empty != room && says(outside, "abc") &&
              says(empty, "abc") && says(room, "abc"));
    nts_release(outside);
    nts_release(empty);
    nts_release(room);
  }

  /* A number's text, as `String(n)` writes it. */
  check("number: NaN, Infinity and -Infinity",
        number_reads(NAN, "NaN") && number_reads(INFINITY, "Infinity") &&
            number_reads(-INFINITY, "-Infinity"));
  check("number: -0 is 0, and whole numbers are their digits",
        number_reads(-0.0, "0") && number_reads(42, "42") &&
            number_reads(-7, "-7") &&
            number_reads(9007199254740991.0, "9007199254740991") &&
            number_reads(-2147483648.0, "-2147483648") &&
            number_reads(2147483647.0, "2147483647") &&
            number_reads(2147483648.0, "2147483648"));
  check("number: fractions, exponents and the 1e21 switch",
        number_reads(0.1, "0.1") && number_reads(1e21, "1e+21") &&
            number_reads(1e-7, "1e-7") && number_reads(123.456, "123.456") &&
            number_reads(5e-324, "5e-324"));

  /* `charAt`'s index: converted, and nothing appended outside the string. */
  check("charAt: -1, the length and beyond append nothing",
        char_at_reads(-1, "") && char_at_reads(3, "") &&
            char_at_reads(1e9, ""));
  check("charAt: 1.7 reads 1 and NaN reads 0",
        char_at_reads(1.7, "y") && char_at_reads(NAN, "x"));

  /* `fromCharCode`'s conversion to a code unit. */
  {
    NtsString *wrapped = nts_str_append_char_code(grown("<"), 65536.0 + 65);
    NtsString *negative = nts_str_append_char_code(grown("<"), -1);
    NtsString *nan = nts_str_append_char_code(grown("<"), NAN);
    const uint16_t ffff[] = {'<', 0xFFFFu};
    const uint16_t zero[] = {'<', 0};
    check("fromCharCode: 65601 wraps to A, -1 to U+FFFF, NaN to U+0000",
          says(wrapped, "<A") && holds(negative, ffff, 2) &&
              holds(nan, zero, 2));
    nts_release(wrapped);
    nts_release(negative);
    nts_release(nan);
  }

  /* `slice`'s bounds. */
  check("slice: negative counts from the end, and out of order is empty",
        slice_reads(-2, 3, "yz") && slice_reads(2, 1, "") &&
            slice_reads(-1, -2, ""));
  check("slice: NaN reads 0, and an end past the string stops at it",
        slice_reads(NAN, 1, "x") && slice_reads(1, 99, "yz"));

  /* Width. */
  {
    const uint16_t wide_units[] = {'a', 0x263Au, 'b'};
    NtsString *wide = nts_str_alloc(wide_units, 3);
    NtsString *widened = nts_str_append_at(grown("<"), wide, 1);
    const uint16_t smile[] = {'<', 0x263Au};
    check("s[i]: a wide unit widens a narrow string",
          holds(widened, smile, 2) && (widened->flags & NTS_TWO_BYTE) != 0);
    NtsString *narrow = nts_str_append_slice(grown("<"), wide, 2, 3);
    check("slice: an all-narrow slice of a wide string keeps it narrow",
          says(narrow, "<b") && (narrow->flags & NTS_TWO_BYTE) == 0);
    NtsString *wider = nts_str_append_slice(grown("<"), wide, 0, 2);
    const uint16_t pair[] = {'<', 'a', 0x263Au};
    check("slice: a slice holding a wide unit widens it",
          holds(wider, pair, 3) && (wider->flags & NTS_TWO_BYTE) != 0);
    NtsString *onto_wide =
        nts_str_append_number(nts_str_append_at(grown("<"), wide, 1), 7);
    const uint16_t seven[] = {'<', 0x263Au, '7'};
    check("number: digits appended onto a wide string are wide units",
          holds(onto_wide, seven, 3));
    nts_release(widened);
    nts_release(narrow);
    nts_release(wider);
    nts_release(onto_wide);
    nts_release(wide);
  }

  /* A slice of the string being appended to. */
  {
    NtsString *self = grown("abcd");
    NtsString *same = nts_str_append_slice(self, self, 1, 3);
    check("slice: of itself, in place", same == self && says(same, "abcdbc"));
    nts_release(same);
    NtsString *tight = exact("abcd");
    NtsString *copy = nts_str_append_slice(tight, tight, 0, 4);
    check("slice: of itself, through a copy", says(copy, "abcdabcd"));
    nts_release(copy);
  }

  nts_release(text_xyz);
  printf("%s\n", failures ? "FAILED" : "string append checks passed");
  return failures ? 1 : 0;
}
