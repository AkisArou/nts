/* Reading an element out of an array whose element type the compiler did not
 * know.
 *
 * `Array.isArray(xs)` proves a value is an array and says nothing about what it
 * holds, so `xs[i]` under that guard has a descriptor at run time and no
 * element type at compile time. `nts_array_element` is the read that asks.
 *
 * What it asks is the point. `size` and `references` were everything a reader
 * had before the descriptor carried an element kind, and they do not separate
 * the two commonest eight-byte cases: `double`, which every `number[]` starts
 * as, and `int64_t`, which element narrowing picks for one that leaves the
 * `i32` range and stays inside the safe integers. Read as the wrong one,
 * 8589934592 is 4.2439915819305446e-314 -- still a number, still finite, and
 * `typeof` says "number" either way, so nothing downstream can catch it.
 *
 * The eight-byte pair is therefore the check this suite exists for. The others
 * are here so that a change which fixes it by breaking them cannot pass.
 */
#include <math.h>
#include <stdio.h>

#include "nts_test_host.h"

static int failures;

static void check(const char *what, bool ok) {
  if (ok) {
    printf("ok   %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* One descriptor per element kind, in the shape `codegen/c` emits. Written out
 * rather than borrowed from the runtime's own so that this suite fails if the
 * emitter and the runtime ever disagree about the field's position. */
static const NtsDescriptor desc_double = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(double), 0u, 0u, 0, 0, "double[]", 0u, 0,
    NTS_ARRAY_FLOAT};
static const NtsDescriptor desc_i64 = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(int64_t), 0u, 0u, 0, 0, "int64_t[]", 0u, 0,
    NTS_ARRAY_INT};
static const NtsDescriptor desc_i32 = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(int32_t), 0u, 0u, 0, 0, "int32_t[]", 0u, 0,
    NTS_ARRAY_INT};
static const NtsDescriptor desc_u32 = {NTS_KIND_ARRAY,
                                       (uint32_t)sizeof(uint32_t),
                                       0u,
                                       0u,
                                       0,
                                       0,
                                       "uint32_t[]",
                                       0u,
                                       0,
                                       NTS_ARRAY_UINT};
static const NtsDescriptor desc_bool = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(bool), 0u, 0u, 0, 0, "bool[]", 0u, 0,
    NTS_ARRAY_BOOL};
static const NtsDescriptor desc_value = {NTS_KIND_ARRAY,
                                         (uint32_t)sizeof(NtsValue),
                                         0u,
                                         1u,
                                         0,
                                         0,
                                         "NtsValue[]",
                                         1u,
                                         0,
                                         NTS_ARRAY_VALUE};

/* The erased receiver the lowering hands the helper. */
static NtsValue as_value(NtsArray *array) {
  return nts_value_of_reference(&array->header, NTS_TAG_OBJECT);
}

int main(void) {
  /* THE CASE THE FIELD EXISTS FOR. Two descriptors that agree on kind, on
   * size, on references and on erasure, and hold different things. */
  check("eight bytes of double and eight bytes of int64 are the same width",
        desc_double.size == desc_i64.size &&
            desc_double.references == desc_i64.references &&
            desc_double.erased == desc_i64.erased);

  NtsArray *wide = nts_array_new(&desc_i64, 3);
  NTS_ITEMS(wide, int64_t)[0] = 4294967296;
  NTS_ITEMS(wide, int64_t)[1] = 8589934592;
  NTS_ITEMS(wide, int64_t)[2] = 4503599627370495;
  NtsValue got = nts_array_element(as_value(wide), 1);
  check("an int64 element reads as the integer it is",
        nts_value_tag(got) == NTS_TAG_NUMBER &&
            nts_value_number(got) == 8589934592.0);
  /* Named so that a regression reports the value a width-only reader gives
   * rather than only that the number was wrong. */
  check("and not as the subnormal double those bits spell",
        nts_value_number(got) > 1.0);
  check("the largest safe integer survives the round trip",
        nts_value_number(nts_array_element(as_value(wide), 2)) ==
            4503599627370495.0);
  nts_release(&wide->header);

  NtsArray *doubles = nts_array_new(&desc_double, 3);
  NTS_ITEMS(doubles, double)[0] = 1.5;
  NTS_ITEMS(doubles, double)[1] = -2.25;
  NTS_ITEMS(doubles, double)[2] = 0.0;
  check("a double element keeps its fraction",
        nts_value_number(nts_array_element(as_value(doubles), 1)) == -2.25);

  /* Out of range is `undefined`, which is what JavaScript says and what the
   * static read -- producing a `double` -- has no way to express. */
  check("past the end is undefined rather than a trap",
        nts_value_tag(nts_array_element(as_value(doubles), 9)) ==
            NTS_TAG_UNDEFINED);
  check("a negative index is undefined too",
        nts_value_tag(nts_array_element(as_value(doubles), -1.0)) ==
            NTS_TAG_UNDEFINED);
  check("a fractional index is undefined rather than truncated",
        nts_value_tag(nts_array_element(as_value(doubles), 0.5)) ==
            NTS_TAG_UNDEFINED);
  nts_release(&doubles->header);

  NtsArray *narrow = nts_array_new(&desc_i32, 2);
  NTS_ITEMS(narrow, int32_t)[0] = -7;
  NTS_ITEMS(narrow, int32_t)[1] = 2147483647;
  check("a signed 32-bit element keeps its sign",
        nts_value_number(nts_array_element(as_value(narrow), 0)) == -7.0);
  check("and its top of range", nts_value_number(nts_array_element(
                                    as_value(narrow), 1)) == 2147483647.0);
  nts_release(&narrow->header);

  /* The same four bytes, read the other way. `-7` as an `int32_t` and
   * 4294967289 as a `uint32_t` are one bit pattern, so this is the four-byte
   * counterpart of the eight-byte pair above. */
  NtsArray *unsigned_ = nts_array_new(&desc_u32, 1);
  NTS_ITEMS(unsigned_, uint32_t)[0] = 4294967289u;
  check("an unsigned 32-bit element is not read as a negative",
        nts_value_number(nts_array_element(as_value(unsigned_), 0)) ==
            4294967289.0);
  nts_release(&unsigned_->header);

  NtsArray *flags = nts_array_new(&desc_bool, 2);
  NTS_ITEMS(flags, bool)[0] = true;
  NTS_ITEMS(flags, bool)[1] = false;
  NtsValue flag = nts_array_element(as_value(flags), 0);
  check("a bool element arrives as a boolean and not as a number",
        nts_value_tag(flag) == NTS_TAG_BOOLEAN && nts_value_boolean(flag));
  check("and false is false rather than absent",
        nts_value_tag(nts_array_element(as_value(flags), 1)) ==
                NTS_TAG_BOOLEAN &&
            !nts_value_boolean(nts_array_element(as_value(flags), 1)));
  nts_release(&flags->header);

  /* An erased slot is handed back as it was stored, and the reference in it
   * has to be retained: the caller's release is emitted whether the value came
   * from a slot or from a fresh allocation. */
  size_t base = nts_live_bytes();
  NtsArray *slots = nts_array_new(&desc_value, 2);
  NtsString *held = nts_string_from_utf8("alpha", 5);
  NTS_ITEMS(slots, NtsValue)[0] = nts_value_of_number(11.0);
  NTS_ITEMS(slots, NtsValue)[1] = nts_value_of_reference(held, NTS_TAG_STRING);
  check("a number in an erased slot reads back as that number",
        nts_value_number(nts_array_element(as_value(slots), 0)) == 11.0);
  NtsValue reference = nts_array_element(as_value(slots), 1);
  check("a reference in an erased slot keeps its tag",
        nts_value_tag(reference) == NTS_TAG_STRING);
  check("and the read owns it, so releasing it does not free the slot",
        nts_value_reference(reference) == held);
  nts_release(nts_value_reference(reference));
  check("the array still holds its string after the reader let go",
        nts_value_reference(NTS_ITEMS(slots, NtsValue)[1])->length == 5);
  nts_release(&slots->header);
  check("and everything comes back", nts_live_bytes() == base);

  printf("%s\n", failures ? "FAILURES" : "all element checks passed");
  return failures ? 1 : 0;
}
