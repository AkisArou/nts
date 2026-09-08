/* `shared.c`'s UTF-16 to UTF-8 conversion, which every module links.
 *
 * The highest-leverage C in this tree: `nts_node_to_utf8` is how every string
 * a binding receives becomes bytes, so a defect here is a defect in `fs` paths,
 * `os` hostnames, `process` arguments and every error message at once. It is
 * also the shape of code that goes wrong quietly -- a bounds test written `>`
 * instead of `>=` overflows by exactly one byte, which is the NUL, and the
 * symptom is a corrupted heap somewhere else entirely.
 *
 * Node cannot have most of these bugs and so has no tests for them: upstream
 * this is V8's `WriteUtf8`, and a JavaScript test cannot reach past it. The
 * unpaired-surrogate rule below is the one place where the two are visibly the
 * same decision, and `shared.c` cites V8 for it.
 */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "shared.h"

const uint32_t nts_closure_call_slot = 0;

static int failures;

static void expect_true(const char *what, bool ok) {
  if (!ok) {
    printf("FAIL %s\n", what);
    failures++;
  } else {
    printf("ok   %s\n", what);
  }
}

static NtsString *units(const uint16_t *codes, size_t count) {
  NtsString *out = nts_string_from_utf8("", 0);
  for (size_t i = 0; i < count; i++) {
    out = nts_concat(out, nts_string_from_char_code((double)codes[i]));
  }
  return out;
}

static bool encodes_to(const char *what, NtsString *s, const char *want,
                       size_t want_length) {
  char buffer[64];
  memset(buffer, '\xAA', sizeof buffer);
  size_t written = nts_node_to_utf8(s, buffer, sizeof buffer);
  bool ok = written == want_length &&
            memcmp(buffer, want, want_length) == 0 &&
            buffer[want_length] == '\0';
  expect_true(what, ok);
  return ok;
}

static void ascii_is_one_byte_each(void) {
  encodes_to("ascii is one byte each", nts_string_from_utf8("abc", 3), "abc", 3);
}

static void two_and_three_byte_forms(void) {
  /* U+00E9 and U+20AC: the boundaries either side of the two/three byte split.
   */
  const uint16_t e_acute[] = {0x00E9};
  encodes_to("a two-byte code point", units(e_acute, 1), "\xC3\xA9", 2);
  const uint16_t euro[] = {0x20AC};
  encodes_to("a three-byte code point", units(euro, 1), "\xE2\x82\xAC", 3);
}

static void a_surrogate_pair_becomes_four_bytes(void) {
  /* U+1F600, as the pair a JavaScript string actually holds. Two UTF-16 units
   * that must produce one four-byte sequence rather than two three-byte ones --
   * which is what a converter that never joined the pair would emit, and it
   * would look almost right. */
  const uint16_t grin[] = {0xD83D, 0xDE00};
  encodes_to("a surrogate pair becomes one four-byte sequence",
             units(grin, 2), "\xF0\x9F\x98\x80", 4);
}

static void an_unpaired_surrogate_becomes_the_replacement(void) {
  /* V8 replaces rather than emitting the invalid three-byte encoding, and
   * `shared.c` follows it deliberately. A high surrogate with nothing after it,
   * and a low one with nothing before it, are both reachable from ordinary
   * JavaScript -- `"\uD83D"` is a perfectly good string. */
  const uint16_t high[] = {0xD83D};
  encodes_to("an unpaired high surrogate becomes U+FFFD", units(high, 1),
             "\xEF\xBF\xBD", 3);
  const uint16_t low[] = {0xDE00};
  encodes_to("an unpaired low surrogate becomes U+FFFD", units(low, 1),
             "\xEF\xBF\xBD", 3);
  /* A high surrogate followed by something that is not a low one: the pair
   * must not be joined, and the tail must still come out. */
  const uint16_t high_then_a[] = {0xD83D, 0x0061};
  encodes_to("a high surrogate followed by a non-surrogate",
             units(high_then_a, 2), "\xEF\xBF\xBD" "a", 4);
}

static void a_short_buffer_truncates_without_overflowing(void) {
  const uint16_t euro[] = {0x20AC, 0x20AC};
  NtsString *s = units(euro, 2);
  /* Room for one three-byte sequence and a NUL, and not for two. The check is
   * `n + needed >= cap`, which reserves the NUL; written `>` it would fill the
   * buffer exactly and then write the terminator one past the end. */
  char buffer[8];
  for (size_t cap = 1; cap <= 8; cap++) {
    memset(buffer, '\xAA', sizeof buffer);
    size_t written = nts_node_to_utf8(s, buffer, cap);
    if (written + 1 > cap || buffer[written] != '\0') {
      printf("FAIL a short buffer truncates without overflowing (cap %zu)\n",
             cap);
      failures++;
      return;
    }
    /* And nothing past the terminator was touched. */
    for (size_t i = cap; i < sizeof buffer; i++) {
      if (buffer[i] != '\xAA') {
        printf("FAIL a short buffer wrote past its capacity (cap %zu)\n", cap);
        failures++;
        return;
      }
    }
  }
  expect_true("a short buffer truncates without overflowing", true);
}

static void a_zero_capacity_writes_nothing(void) {
  char buffer[4];
  memset(buffer, '\xAA', sizeof buffer);
  size_t written = nts_node_to_utf8(nts_string_from_utf8("abc", 3), buffer, 0);
  /* Not even the terminator: there is nowhere to put it. A version that wrote
   * `buf[0] = 0` before checking would corrupt a caller who passed a full
   * buffer and a capacity of zero to mean "measure only". */
  expect_true("a zero capacity writes nothing",
              written == 0 && buffer[0] == '\xAA');
}

static void the_allocating_form_agrees_and_reports_its_length(void) {
  const uint16_t grin[] = {0xD83D, 0xDE00, 0x0061};
  size_t length = 0;
  char *out = nts_node_to_utf8_alloc(units(grin, 3), &length);
  bool ok = out != NULL && length == 5 &&
            memcmp(out, "\xF0\x9F\x98\x80" "a", 5) == 0 && out[5] == '\0';
  free(out);
  expect_true("the allocating form agrees and reports its length", ok);
  /* Its buffer is three bytes per UTF-16 unit plus one. A surrogate pair is two
   * units and four bytes, so the worst case per unit is three -- from a
   * three-byte BMP character or a replaced unpaired surrogate -- and the sizing
   * holds. A string of nothing but pairs is the case that would break a
   * four-bytes-per-unit assumption in the other direction. */
  const uint16_t pairs[] = {0xD83D, 0xDE00, 0xD83D, 0xDE00};
  size_t pair_length = 0;
  char *packed = nts_node_to_utf8_alloc(units(pairs, 4), &pair_length);
  expect_true("a string of only surrogate pairs is sized correctly",
              packed != NULL && pair_length == 8);
  free(packed);

  /* And the case that actually needs the three. Every check above fits in two
   * bytes per unit -- a pair is two units and four bytes -- so all of them pass
   * with the allocation sized at `length * 2 + 1`, which silently truncates a
   * BMP string instead of overflowing. The control found that, and it is a
   * missing assertion rather than a redundant line: this is the shortest string
   * that can tell the two sizings apart, and every path where a filename or a
   * hostname is not Latin goes through it. */
  const uint16_t euros[] = {0x20AC, 0x20AC, 0x20AC, 0x20AC};
  size_t euro_length = 0;
  char *wide = nts_node_to_utf8_alloc(units(euros, 4), &euro_length);
  expect_true("three-byte characters are not truncated by the sizing",
              wide != NULL && euro_length == 12 &&
                  memcmp(wide, "\xE2\x82\xAC\xE2\x82\xAC\xE2\x82\xAC\xE2\x82\xAC",
                         12) == 0);
  free(wide);
}

static void an_empty_string_is_empty_and_terminated(void) {
  char buffer[4];
  memset(buffer, '\xAA', sizeof buffer);
  size_t written = nts_node_to_utf8(nts_string_from_utf8("", 0), buffer, 4);
  expect_true("an empty string is empty and terminated",
              written == 0 && buffer[0] == '\0');
}

int main(void) {
  ascii_is_one_byte_each();
  two_and_three_byte_forms();
  a_surrogate_pair_becomes_four_bytes();
  an_unpaired_surrogate_becomes_the_replacement();
  a_short_buffer_truncates_without_overflowing();
  a_zero_capacity_writes_nothing();
  the_allocating_form_agrees_and_reports_its_length();
  an_empty_string_is_empty_and_terminated();

  if (failures) {
    printf("%d failure(s)\n", failures);
    return 1;
  }
  printf("all utf8 conversion checks agree with the contract\n");
  return 0;
}
