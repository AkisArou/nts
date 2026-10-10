/* Node's primitive rules, exercised through the native erased storage rather
 * than typed __int128 arithmetic. Allocation identity must not become bigint
 * identity. Containers own a box and the box owns no outgoing references. */
#include "nts_runtime.h"
#include "nts_test_host.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static unsigned failures;

static void expect(const char *what, bool holds) {
  printf("%s %s\n", holds ? "ok " : "FAIL", what);
  failures += !holds;
}

static NtsValue bigint(__int128 n) {
  return nts_value_of_reference((NtsHeader *)nts_bigint_box(n), NTS_TAG_BIGINT);
}

static bool text_is(NtsString *text, const char *wanted) {
  size_t length = strlen(wanted);
  bool holds = text && text->length == length;
  for (size_t at = 0; holds && at < length; at++) {
    holds = nts_unit(text, (uint32_t)at) == (unsigned char)wanted[at];
  }
  nts_release((NtsHeader *)text);
  return holds;
}

static void one_value(__int128 n, const char *plain, const char *inspected) {
  NtsValue a = bigint(n);
  NtsValue b = bigint(n);
  expect("separate boxes have separate allocations",
         nts_value_reference(a) != nts_value_reference(b));
  expect("tag identifies the primitive", nts_value_tag(a) == NTS_TAG_BIGINT);
  expect("owned storage is traced", NTS_TAG_IS_MANAGED(NTS_TAG_BIGINT));
  expect("descriptor recovers the tag",
         nts_tag_of_reference(nts_value_reference(a)) == NTS_TAG_BIGINT);
  expect("unbox preserves all 128 bits",
         nts_bigint_unbox((const NtsBigIntBox *)nts_value_reference(a)) == n);
  expect("typeof is bigint", text_is(nts_tag_name(NTS_TAG_BIGINT), "bigint"));
  expect("String uses integer text", text_is(nts_value_to_string(a), plain));
  expect("inspection adds n", text_is(nts_value_inspect(a), inspected));
  expect("truthiness follows the integer", nts_value_truthy(a) == (n != 0));
  expect("separate equal boxes compare equal", nts_value_strict_eq(a, b));
  expect("bigint differs from number",
         !nts_value_strict_eq(a, nts_value_of_number((double)n)));
  expect("bigint differs from object identity",
         !nts_value_eq_reference(a, nts_value_reference(a)));
  expect("a bigint is not an array", !nts_is_array(a));
  expect("explicit Number permits bigint",
         nts_value_to_number_explicit(a) == (double)n);

  NtsMap *map = nts_map_new(NTS_KEY_ERASED);
  nts_map_set(map, a, nts_value_of_number(11));
  nts_map_set(map, b, nts_value_of_number(22));
  expect("Map coalesces equal integer keys", map->header.length == 1);
  expect("Map finds separately boxed key", nts_map_has(map, b));
  NtsValue found = nts_map_get(map, b);
  expect("Map replacement follows value equality",
         nts_value_tag(found) == NTS_TAG_NUMBER &&
             nts_value_number(found) == 22);
  nts_value_release(found);
  nts_map_set(map, nts_value_of_number((double)n), nts_value_of_number(33));
  expect("number and bigint remain different keys", map->header.length == 2);
  nts_release((NtsHeader *)map);

  NtsMap *set = nts_set_new(NTS_KEY_ERASED);
  nts_set_add(set, a);
  nts_set_add(set, b);
  expect("Set coalesces equal integer keys", set->header.length == 1);
  nts_release((NtsHeader *)set);

  NtsArray *array = nts_array_new(&nts_desc_ref, 1);
  nts_value_retain(a);
  NTS_ITEMS(array, NtsHeader *)[0] = nts_value_reference(a);
  found = nts_array_element(
      nts_value_of_reference((NtsHeader *)array, NTS_TAG_OBJECT), 0);
  expect("reference array reader recovers bigint",
         nts_value_tag(found) == NTS_TAG_BIGINT &&
             nts_value_strict_eq(found, b));
  nts_value_release(found);
  nts_release((NtsHeader *)array);

  static const NtsDescriptor wide = {
      NTS_KIND_ARRAY, sizeof(__int128), 0, 0,    NULL, NULL, "bigint[]", 0,
      NULL,           NTS_ARRAY_BIGINT, 0, NULL, NULL, NULL};
  array = nts_array_new(&wide, 1);
  NTS_ITEMS(array, __int128)[0] = n;
  found = nts_array_element(
      nts_value_of_reference((NtsHeader *)array, NTS_TAG_OBJECT), 0);
  expect("unboxed array reader preserves the complete integer",
         nts_value_tag(found) == NTS_TAG_BIGINT &&
             nts_value_strict_eq(found, b));
  expect("unboxed array read is independently owned",
         nts_value_reference(found) != nts_value_reference(a));
  nts_value_release(found);
  found = nts_array_element(
      nts_value_of_reference((NtsHeader *)array, NTS_TAG_OBJECT), 1);
  expect("out of range bigint element is undefined",
         nts_value_tag(found) == NTS_TAG_UNDEFINED);
  nts_release((NtsHeader *)array);

  uintptr_t before = nts_value_reference(a)->reserved;
  NtsPromise *promise = nts_promise_new();
  nts_promise_fulfill_value(promise, a);
  expect("promise owns erased bigint",
         nts_value_reference(a)->reserved == before + 1);
  found = nts_promise_value(promise);
  expect("promise preserves bigint tag and integer",
         nts_value_tag(found) == NTS_TAG_BIGINT &&
             nts_value_strict_eq(found, b));
  nts_release((NtsHeader *)promise);
  expect("promise releases erased bigint",
         nts_value_reference(a)->reserved == before);
  nts_value_release(a);
  nts_value_release(b);
}

int main(void) {
  nts_test_host_install();
  size_t baseline = nts_live_bytes();
  one_value(0, "0", "0n");
  one_value(-1, "-1", "-1n");
  one_value((__int128)9007199254740993ULL, "9007199254740993",
            "9007199254740993n");
  __int128 maximum = (__int128)(((unsigned __int128)1 << 127) - 1);
  __int128 minimum = -maximum - 1;
  one_value(maximum, "170141183460469231731687303715884105727",
            "170141183460469231731687303715884105727n");
  one_value(minimum, "-170141183460469231731687303715884105728",
            "-170141183460469231731687303715884105728n");

  /* `Number(x)` of a bigint rounds to the nearest double, ties to even: node
   * answers 9007199254740992 for 2^53 + 1. `one_value`'s check compares the
   * same cast on both sides; this one is a value written down. */
  NtsValue rounded = bigint((__int128)9007199254740993ULL);
  expect("explicit Number rounds 2^53 + 1 to 2^53",
         nts_value_to_number_explicit(rounded) == 9007199254740992.0);
  nts_value_release(rounded);
  NtsValue low = bigint(7);
  NtsValue high = bigint(((__int128)1 << 64) + 7);
  expect("equality reads the high word", !nts_value_strict_eq(low, high));
  NtsMap *map = nts_map_new(NTS_KEY_ERASED);
  nts_map_set(map, low, nts_value_of_number(1));
  nts_map_set(map, high, nts_value_of_number(2));
  expect("different high words remain different keys", map->header.length == 2);
  NtsValue found = nts_map_get(map, high);
  expect("high word key is retrievable", nts_value_number(found) == 2);
  nts_value_release(found);
  nts_release((NtsHeader *)map);
  nts_value_release(low);
  nts_value_release(high);
#ifdef NTS_PROVIDER_RC
  nts_collect_cycles();
  expect("every native box and container is released",
         nts_live_bytes() == baseline);
#else
  (void)baseline;
#endif
  return failures == 0 ? 0 : 1;
}
