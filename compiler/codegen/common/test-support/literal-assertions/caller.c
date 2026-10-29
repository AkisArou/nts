#include "program.h"
#include <stdio.h>
#include <stdlib.h>

static unsigned cases;
static unsigned failures;
static void expect(const char *name, double found, double wanted) {
  cases++;
  if ((isnan(wanted) && isnan(found)) ||
      (found == wanted && (wanted != 0 || signbit(found) == signbit(wanted))))
    return;
  fprintf(stderr, "%s: %.17g, expected %.17g\n", name, found, wanted);
  failures++;
}
static NtsValue text(const char *value) {
  return nts_value_of_reference(
      (NtsHeader *)nts_string_from_utf8(value, strlen(value)), NTS_TAG_STRING);
}
static void erased(const char *name, double (*function)(NtsValue),
                   NtsValue value, double wanted) {
  expect(name, function(value), wanted);
  nts_value_release(value);
}
int main(void) {
  const double inputs[] = {64, 63, 0, -0., 1, 2, 3, 7, 0.5, NAN, INFINITY};
  for (size_t i = 0; i < sizeof(inputs) / sizeof(inputs[0]); i++) {
    double n = inputs[i];
    erased("number", numberClaim, nts_value_of_number(n), n == 64 ? 64 : -1);
    erased("any", anyClaim, nts_value_of_number(n), n == 64 ? 64 : -1);
    erased("union", unionClaim, nts_value_of_number(n),
           n == 0 || n == 1 || n == 2 || n == 3 ? n : -1);
    erased("enum", enumClaim, nts_value_of_number(n),
           n == 3 || n == 7 ? n : -1);
    erased("member", enumMemberClaim, nts_value_of_number(n),
           n == 64 ? 64 : -1);
    expect("recovered", recoveredErasure(n), n == 64 ? 64 : -1);
    expect("typed number", typedNumber(n), n);
    expect("typed union", typedUnion(n), n);
    expect("typed enum", typedEnum(n), n);
  }
  erased("string match", stringClaim, text("a"), 1);
  erased("string mismatch", stringClaim, text("b"), -1);
  erased("string wrong tag", stringClaim, nts_value_of_number(64), -1);
  erased("string union first", stringUnionClaim, text("a"), 1);
  erased("string union second", stringUnionClaim, text("b"), 1);
  erased("string union mismatch", stringUnionClaim, text("c"), -1);
  erased("called mixed match", throughMixedCall, text("a"), 1);
  erased("called mixed mismatch", throughMixedCall, text("b"), -1);
  erased("finally match", finalized, nts_value_of_number(64), 641);
  erased("finally mismatch", finalized, nts_value_of_number(63), -9);
  erased("index match", beforeIndexEffect, text("a"), 1);
  erased("index null", beforeIndexEffect, nts_value_of_null(), -10);
  erased("index undefined", beforeIndexEffect, nts_value_of_undefined(), -10);
  erased("number wrong tag", numberClaim, text("64"), -1);
  erased("mixed number", mixedClaim, nts_value_of_number(64), 64);
  erased("mixed string", mixedClaim, text("a"), 1);
  erased("mixed other number", mixedClaim, nts_value_of_number(63), -1);
  erased("mixed other string", mixedClaim, text("b"), -1);
  erased("nullable null", nullableClaim, nts_value_of_null(), 0);
  erased("nullable string", nullableClaim, text("a"), 1);
  erased("nullable mismatch", nullableClaim, text("b"), -1);
  erased("nullable undefined", nullableClaim, nts_value_of_undefined(), -1);
  erased("boolean match", booleanClaim, nts_value_of_boolean(true), 1);
  erased("boolean mismatch", booleanClaim, nts_value_of_boolean(false), -1);
  erased("boolean wrong tag", booleanClaim, nts_value_of_number(1), -1);
  erased("zero", zeroClaim, nts_value_of_number(0), INFINITY);
  erased("negative zero", zeroClaim, nts_value_of_number(-0.), -INFINITY);
  erased(
      "bigint match", bigintClaim,
      nts_value_of_reference((NtsHeader *)nts_bigint_box(64), NTS_TAG_BIGINT),
      1);
  erased(
      "bigint mismatch", bigintClaim,
      nts_value_of_reference((NtsHeader *)nts_bigint_box(65), NTS_TAG_BIGINT),
      -1);
  erased("bigint wrong tag", bigintClaim, nts_value_of_number(64), -1);
  NtsString *before = nts_string_from_utf8("b", 1);
  NtsString *after = typedString(before);
  expect("typed string identity", after == before, 1);
  nts_release((NtsHeader *)after);
  nts_release((NtsHeader *)before);
  nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
  if (nts_live_count() || nts_live_bytes())
    return 2;
#endif
  printf("%u cases\n", cases);
  return failures ? 1 : 0;
}
