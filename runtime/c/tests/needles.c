/* `includes` and `indexOf` on an array of strings, with the needle erased.
 *
 * `validateOneOf(value: unknown, name: string, oneOf: Choices)` is node's shape
 * and one of its most-called validators: the array holds strings, the needle is
 * an `unknown`, and nothing narrows it before the call. The lowering picked the
 * helper from the array's element type alone, so `const NtsString *` was handed
 * an `NtsValue` -- four modules' `program.c` stopped compiling the hour that
 * validator first became reachable, and clang is what said so.
 *
 * The repair that would have been wrong is unerasing the needle. That is the
 * whole content of this suite: an `unknown` that is not a string is not an
 * error here. SameValueZero says a number is simply absent from an array of
 * strings, and node answers `false` rather than throwing. Unerasing aborts, and
 * a suite that only ever passed strings would agree with either repair.
 *
 * No `-DNTS_PROVIDER_RC`: nothing here is about ownership.
 */
#include <stdio.h>
#include <string.h>

#include "nts_test_host.h"

static int failures;

static void check(const char *what, bool ok) {
  if (ok) {
    printf("ok %s\n", what);
  } else {
    printf("FAIL %s\n", what);
    failures++;
  }
}

/* An array of references, in the shape `codegen/c` emits for `string[]`. */
static const NtsDescriptor desc_strings = {NTS_KIND_ARRAY,
                                           (uint32_t)sizeof(void *),
                                           0u,
                                           0u,
                                           0,
                                           0,
                                           "NtsString*[]",
                                           0u,
                                           0,
                                           NTS_ARRAY_REFERENCE};

int main(void) {
  NtsArray *options = nts_array_new(&desc_strings, 0);
  NtsString *ascii = nts_string_from_utf8("ascii", 5);
  NtsString *utf8 = nts_string_from_utf8("utf8", 4);
  nts_array_push_ref(options, ascii);
  nts_array_push_ref(options, utf8);

  /* The needle the four modules actually pass: a string, erased. */
  NtsString *found = nts_string_from_utf8("utf8", 4);
  NtsValue erased_string =
      nts_value_of_reference((NtsHeader *)found, NTS_TAG_STRING);
  check("an erased string that is present is found",
        nts_array_includes_str_value(options, erased_string));
  check("and indexOf gives its position, not merely a hit",
        nts_array_index_of_str_value(options, erased_string) == 1.0);

  /* Equality is by value: a *different* string with the same characters. */
  check("a distinct string with the same characters is still found",
        found != utf8);

  NtsString *absent = nts_string_from_utf8("latin1", 6);
  NtsValue erased_absent =
      nts_value_of_reference((NtsHeader *)absent, NTS_TAG_STRING);
  check("an erased string that is absent is not found",
        !nts_array_includes_str_value(options, erased_absent));
  check("and indexOf says -1 for it",
        nts_array_index_of_str_value(options, erased_absent) == -1.0);

  /* The cases the wrong repair would have aborted on. Each is a tag that is
   * not a string, and node answers `false` for every one of them. */
  check("a number needle answers false rather than aborting",
        !nts_array_includes_str_value(options, nts_value_of_number(42.0)));
  check("and indexOf answers -1 for it",
        nts_array_index_of_str_value(options, nts_value_of_number(42.0)) ==
            -1.0);
  check("a boolean needle answers false",
        !nts_array_includes_str_value(options, nts_value_of_boolean(true)));
  check("undefined answers false",
        !nts_array_includes_str_value(options, nts_value_of_undefined()));
  check("null answers false",
        !nts_array_includes_str_value(options, nts_value_of_null()));

  /* An object is the tag that shares a slot with a string, so it is the one a
   * check on the *payload* rather than the tag would let through. */
  NtsValue erased_object =
      nts_value_of_reference((NtsHeader *)options, NTS_TAG_OBJECT);
  check("an object needle answers false, though its payload is a reference",
        !nts_array_includes_str_value(options, erased_object));

  /* An empty array has no element to compare against, which is the one case
   * where a loop that reads before it tests would still be wrong. */
  NtsArray *empty = nts_array_new(&desc_strings, 0);
  check("an empty array finds nothing, string needle or not",
        !nts_array_includes_str_value(empty, erased_string) &&
            !nts_array_includes_str_value(empty, nts_value_of_number(0.0)));

  printf("%s\n", failures ? "FAILURES" : "all needle checks passed");
  return failures ? 1 : 0;
}
