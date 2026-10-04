#include "nts_icu.h"
#include <unicode/ucol.h>
#include <unicode/uiter.h>
#include <stdlib.h>

static UCollator *open_collator(NtsString *locale, UErrorCode *status) {
  if (!nts_icu_versions_match()) return NULL;
  for (uint32_t index = 0; index < locale->length; index++)
    if (nts_unit(locale, index) == 0 || nts_unit(locale, index) > 127) return NULL;
  const char *name = nts_string_to_cstring(locale);
  UCollator *result = ucol_open(name, status);
  nts_cstring_release(locale, name);
  if (U_FAILURE(*status)) { if (result != NULL) ucol_close(result); return NULL; }
  return result;
}

static void close_collator(void *state, size_t data) {
  (void)data;
  ucol_close(state);
}

static UCollator *collator_state(NtsHeader *handle) {
  if (handle == NULL || handle->descriptor == NULL || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = (NtsBoxed *)handle;
  if (box->free != close_collator || box->boxed == NULL) abort();
  return box->boxed;
}

double nts_icu_collation_defaults(NtsString *locale) {
  UErrorCode status = U_ZERO_ERROR;
  UCollator *collator = open_collator(locale, &status);
  if (collator == NULL) return NAN;
  const UCollationStrength strength = ucol_getStrength(collator);
  const UColAttributeValue level = ucol_getAttribute(collator, UCOL_CASE_LEVEL, &status);
  const UColAttributeValue alternate = ucol_getAttribute(collator, UCOL_ALTERNATE_HANDLING, &status);
  const UColAttributeValue first = ucol_getAttribute(collator, UCOL_CASE_FIRST, &status);
  const int32_t sensitivity = strength == UCOL_PRIMARY ? (level == UCOL_ON ? 2 : 0) : strength == UCOL_SECONDARY ? 1 : 3;
  const int32_t case_first = first == UCOL_UPPER_FIRST ? 1 : first == UCOL_LOWER_FIRST ? 2 : 0;
  ucol_close(collator);
  return U_SUCCESS(status) ? sensitivity | (alternate == UCOL_SHIFTED ? 4 : 0) | (case_first << 3) : NAN;
}

NtsHeader *nts_icu_collator_open(NtsString *locale, double sensitivity, bool punctuation, bool numeric, double case_first) {
  if (sensitivity < 0 || sensitivity > 3 || sensitivity != floor(sensitivity) ||
      case_first < 0 || case_first > 2 || case_first != floor(case_first)) return NULL;
  UErrorCode status = U_ZERO_ERROR;
  UCollator *collator = open_collator(locale, &status);
  if (collator == NULL) return NULL;
  ucol_setStrength(collator, sensitivity == 0 || sensitivity == 2 ? UCOL_PRIMARY : sensitivity == 1 ? UCOL_SECONDARY : UCOL_TERTIARY);
  ucol_setAttribute(collator, UCOL_CASE_LEVEL, sensitivity == 2 ? UCOL_ON : UCOL_OFF, &status);
  ucol_setAttribute(collator, UCOL_ALTERNATE_HANDLING, punctuation ? UCOL_SHIFTED : UCOL_NON_IGNORABLE, &status);
  ucol_setMaxVariable(collator, UCOL_REORDER_CODE_PUNCTUATION, &status);
  ucol_setAttribute(collator, UCOL_NUMERIC_COLLATION, numeric ? UCOL_ON : UCOL_OFF, &status);
  ucol_setAttribute(collator, UCOL_CASE_FIRST, case_first == 1 ? UCOL_UPPER_FIRST : case_first == 2 ? UCOL_LOWER_FIRST : UCOL_OFF, &status);
  ucol_setAttribute(collator, UCOL_NORMALIZATION_MODE, UCOL_ON, &status);
  if (U_FAILURE(status)) { ucol_close(collator); return NULL; }
  return nts_boxed_new(collator, close_collator, 0);
}

// ICU's iterator protocol reads the runtime's Latin-1 storage directly. All
// cursor state lives on the stack; comparing does not decode or copy strings.
static int32_t U_CALLCONV latin_index(UCharIterator *iter, UCharIteratorOrigin origin) {
  switch (origin) {
    case UITER_START: case UITER_ZERO: return 0;
    case UITER_CURRENT: return iter->index;
    case UITER_LIMIT: case UITER_LENGTH: return iter->length;
    default: return U_SENTINEL;
  }
}
static int32_t U_CALLCONV latin_move(UCharIterator *iter, int32_t delta, UCharIteratorOrigin origin) {
  const int32_t base = latin_index(iter, origin);
  if (base < 0) return U_SENTINEL;
  const int64_t next = (int64_t)base + delta;
  iter->index = next < 0 ? 0 : next > iter->length ? iter->length : (int32_t)next;
  return iter->index;
}
static UBool U_CALLCONV latin_has_next(UCharIterator *iter) { return iter->index < iter->length; }
static UBool U_CALLCONV latin_has_previous(UCharIterator *iter) { return iter->index > 0; }
static UChar32 U_CALLCONV latin_current(UCharIterator *iter) {
  return iter->index < iter->length ? ((const uint8_t *)iter->context)[iter->index] : U_SENTINEL;
}
static UChar32 U_CALLCONV latin_next(UCharIterator *iter) {
  return iter->index < iter->length ? ((const uint8_t *)iter->context)[iter->index++] : U_SENTINEL;
}
static UChar32 U_CALLCONV latin_previous(UCharIterator *iter) {
  return iter->index > 0 ? ((const uint8_t *)iter->context)[--iter->index] : U_SENTINEL;
}
static uint32_t U_CALLCONV latin_state(const UCharIterator *iter) { return (uint32_t)iter->index; }
static void U_CALLCONV latin_set_state(UCharIterator *iter, uint32_t state, UErrorCode *status) {
  if (U_FAILURE(*status)) return;
  if (state > (uint32_t)iter->length) { *status = U_INDEX_OUTOFBOUNDS_ERROR; return; }
  iter->index = (int32_t)state;
}
static void string_iterator(UCharIterator *iter, NtsString *string) {
  if ((string->flags & NTS_TWO_BYTE) != 0) {
    uiter_setString(iter, NTS_ELEMENTS(string, UChar), (int32_t)string->length);
    return;
  }
  *iter = (UCharIterator){ .context = NTS_ELEMENTS(string, uint8_t), .length = (int32_t)string->length,
    .start = 0, .index = 0, .limit = (int32_t)string->length, .reservedField = 0,
    .getIndex = latin_index, .move = latin_move, .hasNext = latin_has_next, .hasPrevious = latin_has_previous,
    .current = latin_current, .next = latin_next, .previous = latin_previous, .reservedFn = NULL,
    .getState = latin_state, .setState = latin_set_state };
}

double nts_icu_collator_compare(NtsHeader *handle, NtsString *one, NtsString *two) {
  if (one->length > INT32_MAX || two->length > INT32_MAX) return NAN;
  UCollator *collator = collator_state(handle);
  if ((one->flags & two->flags & NTS_TWO_BYTE) != 0)
    return ucol_strcoll(collator, NTS_ELEMENTS(one, UChar), (int32_t)one->length, NTS_ELEMENTS(two, UChar), (int32_t)two->length);
  UCharIterator first, second;
  string_iterator(&first, one);
  string_iterator(&second, two);
  UErrorCode status = U_ZERO_ERROR;
  const UCollationResult result = ucol_strcollIter(collator, &first, &second, &status);
  return U_SUCCESS(status) ? result : NAN;
}
