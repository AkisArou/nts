/* Node v24.20.0's null[key] messages use side-effect-free descriptions.
 * In particular, these are not String(key): Symbol has diagnostic truncation
 * and an object must not run its toString/valueOf while making the error. */
#include "nts_runtime.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static unsigned failures;
static unsigned callbacks;

static void expect(const char *what, bool holds) {
  printf("%s %s\n", holds ? "ok " : "FAIL", what);
  failures += !holds;
}

static void key_is(NtsValue key, const char *wanted) {
  NtsString *out = nts_access_key_description(key);
  size_t length = strlen(wanted);
  bool same = out && out->length == length;
  for (size_t at = 0; same && at < length; at++) {
    same = nts_unit(out, (uint32_t)at) == (unsigned char)wanted[at];
  }
  expect(wanted, same);
  nts_release((NtsHeader *)out);
}

static NtsString *unexpected(const NtsHeader *object) {
  (void)object;
  callbacks++;
  return NULL;
}

static void objects_run_no_code(void) {
  static const NtsDescriptor descriptor = {NTS_KIND_OBJECT,
                                           sizeof(NtsHeader),
                                           0,
                                           0,
                                           NULL,
                                           NULL,
                                           "Key",
                                           0,
                                           NULL,
                                           NTS_ARRAY_UNKNOWN,
                                           0,
                                           NULL,
                                           unexpected,
                                           NULL,
                                           NULL,
                                           NULL};
  NtsHeader object = {&descriptor, NTS_IMMORTAL, 0, 0};
  expect("object description omitted",
         nts_access_key_description(
             nts_value_of_reference(&object, NTS_TAG_OBJECT)) == NULL);
  expect("function description omitted",
         nts_access_key_description(
             nts_value_of_reference(&object, NTS_TAG_FUNCTION)) == NULL);
  expect("no program callback ran", callbacks == 0);
}

static void symbol_boundary(unsigned length) {
  /* A two-byte UTF-8 character is one UTF-16 unit. Node abbreviates at 129
   * units, not at 129 bytes, and keeps exactly 56 units at either end. */
  char bytes[258];
  for (unsigned at = 0; at < length; at++) {
    bytes[at * 2] = (char)0xce;
    bytes[at * 2 + 1] = (char)0xb1;
  }
  NtsString *description = nts_string_from_utf8(bytes, length * 2);
  NtsSymbol *symbol = nts_symbol_new(description);
  NtsString *out = nts_access_key_description(
      nts_value_of_reference((NtsHeader *)symbol, NTS_TAG_SYMBOL));
  expect("symbol diagnostic length",
         out->length == (length == 128 ? 136u : 135u));
  expect("symbol preserves two-byte units", nts_unit(out, 7) == 0x3b1);
  expect("symbol truncation boundary",
         nts_unit(out, 63) == (length == 128 ? 0x3b1 : '.'));
  expect("symbol preserves final units",
         nts_unit(out, out->length - 2) == 0x3b1);
  nts_release((NtsHeader *)out);
  nts_release((NtsHeader *)symbol);
  nts_release((NtsHeader *)description);
}

int main(void) {
  size_t live = nts_live_count();
  key_is(nts_value_of_undefined(), "undefined");
  key_is(nts_value_of_null(), "null");
  key_is(nts_value_of_boolean(false), "false");
  key_is(nts_value_of_boolean(true), "true");
  key_is(nts_value_of_number(-0.0), "0");
  key_is(nts_value_of_number(NAN), "NaN");
  key_is(nts_value_of_number(INFINITY), "Infinity");
  key_is(nts_value_of_number(-INFINITY), "-Infinity");
  key_is(nts_value_of_number(1.25), "1.25");
  NtsString *text = nts_string_from_utf8("plain", 5);
  key_is(nts_value_of_reference((NtsHeader *)text, NTS_TAG_STRING), "plain");
  nts_release((NtsHeader *)text);
  NtsBigIntBox *bigint = nts_bigint_box(-9007199254740993);
  key_is(nts_value_of_reference((NtsHeader *)bigint, NTS_TAG_BIGINT),
         "-9007199254740993");
  nts_release((NtsHeader *)bigint);
  NtsSymbol *symbol = nts_symbol_new(NULL);
  key_is(nts_value_of_reference((NtsHeader *)symbol, NTS_TAG_SYMBOL),
         "Symbol()");
  nts_release((NtsHeader *)symbol);
  symbol_boundary(128);
  symbol_boundary(129);
  objects_run_no_code();
  expect("descriptions release every owned result", nts_live_count() == live);
  return failures == 0 ? 0 : 1;
}
