#include "nts_icu.h"
#include <unicode/ureldatefmt.h>
#include <unicode/unum.h>
#include <unicode/uformattedvalue.h>
#include <stdlib.h>

typedef struct {
  URelativeDateTimeFormatter *formatter;
  UFormattedRelativeDateTime *result;
  UConstrainedFieldPosition *position;
  int32_t *spans;
  int32_t count, capacity;
} RelativeFormatter;

static void close_relative(void *state, size_t data) {
  (void)data;
  RelativeFormatter *relative = state;
  if (relative->formatter != NULL) ureldatefmt_close(relative->formatter);
  if (relative->result != NULL) ureldatefmt_closeResult(relative->result);
  if (relative->position != NULL) ucfpos_close(relative->position);
  free(relative->spans);
  free(relative);
}

static RelativeFormatter *relative_state(NtsHeader *handle) {
  if (handle == NULL || handle->descriptor == NULL || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = (NtsBoxed *)handle;
  if (box->free != close_relative || box->boxed == NULL) abort();
  return box->boxed;
}

NtsHeader *nts_icu_relative_open(NtsString *locale, double style) {
  if (!nts_icu_versions_match() || !isfinite(style) || style < 0 || style > 2 || style != floor(style)) return NULL;
  for (uint32_t index = 0; index < locale->length; index++)
    if (nts_unit(locale, index) == 0 || nts_unit(locale, index) > 127) return NULL;
  RelativeFormatter *relative = calloc(1, sizeof(*relative));
  if (relative == NULL) abort();
  UErrorCode status = U_ZERO_ERROR;
  const char *tag = nts_string_to_cstring(locale);
  UNumberFormat *numbers = unum_open(UNUM_DECIMAL, NULL, 0, tag, NULL, &status);
  if (U_FAILURE(status)) {
    if (numbers != NULL) unum_close(numbers);
    nts_cstring_release(locale, tag);
    close_relative(relative, 0);
    return NULL;
  }
  unum_setAttribute(numbers, UNUM_MIN_INTEGER_DIGITS, 1);
  unum_setAttribute(numbers, UNUM_MIN_FRACTION_DIGITS, 0);
  unum_setAttribute(numbers, UNUM_MAX_FRACTION_DIGITS, 3);
  unum_setAttribute(numbers, UNUM_GROUPING_USED, 1);
  unum_setAttribute(numbers, UNUM_MINIMUM_GROUPING_DIGITS, UNUM_MINIMUM_GROUPING_DIGITS_AUTO);
  unum_setAttribute(numbers, UNUM_ROUNDING_MODE, UNUM_ROUND_HALFUP);
  // The relative formatter adopts numbers, including its failure paths.
  relative->formatter = ureldatefmt_open(tag, numbers, (UDateRelativeDateTimeFormatterStyle)(int32_t)style,
      UDISPCTX_CAPITALIZATION_NONE, &status);
  nts_cstring_release(locale, tag);
  relative->result = ureldatefmt_openResult(&status);
  if (U_FAILURE(status)) { close_relative(relative, 0); return NULL; }
  return nts_boxed_new(relative, close_relative, 0);
}

NtsString *nts_icu_relative_format(NtsHeader *handle, double value, double unit, bool automatic, bool fields) {
  RelativeFormatter *relative = relative_state(handle);
  relative->count = 0;
  if (!isfinite(value) || !isfinite(unit) || unit < 0 || unit > 7 || unit != floor(unit)) return NULL;
  UErrorCode status = U_ZERO_ERROR;
  if (automatic) ureldatefmt_formatToResult(relative->formatter, value, (URelativeDateTimeUnit)(int32_t)unit, relative->result, &status);
  else ureldatefmt_formatNumericToResult(relative->formatter, value, (URelativeDateTimeUnit)(int32_t)unit, relative->result, &status);
  const UFormattedValue *formatted = ureldatefmt_resultAsValue(relative->result, &status);
  if (fields) {
    if (relative->position == NULL) relative->position = ucfpos_open(&status);
    ucfpos_reset(relative->position, &status);
    while (ufmtval_nextPosition(formatted, relative->position, &status)) {
      const int32_t category = ucfpos_getCategory(relative->position, &status);
      int32_t field = ucfpos_getField(relative->position, &status);
      if (category == UFIELD_CATEGORY_RELATIVE_DATETIME && field == UDAT_REL_NUMERIC_FIELD) field = 14;
      else if (category != UFIELD_CATEGORY_NUMBER) continue;
      else if (field != UNUM_INTEGER_FIELD && field != UNUM_FRACTION_FIELD && field != UNUM_DECIMAL_SEPARATOR_FIELD && field != UNUM_GROUPING_SEPARATOR_FIELD) return NULL;
      if (relative->count == relative->capacity) {
        const int32_t capacity = relative->capacity == 0 ? 8 : relative->capacity * 2;
        int32_t *spans = realloc(relative->spans, (size_t)capacity * 3 * sizeof(*spans));
        if (spans == NULL) abort();
        relative->spans = spans;
        relative->capacity = capacity;
      }
      int32_t *span = relative->spans + relative->count * 3;
      span[0] = field;
      ucfpos_getIndexes(relative->position, span + 1, span + 2, &status);
      relative->count++;
    }
  }
  int32_t length = 0;
  const UChar *text = ufmtval_getString(formatted, &length, &status);
  return U_SUCCESS(status) ? nts_str_alloc(text, (uint32_t)length) : NULL;
}

double nts_icu_relative_field_count(NtsHeader *handle) { return relative_state(handle)->count; }

double nts_icu_relative_field(NtsHeader *handle, double index, double component) {
  RelativeFormatter *relative = relative_state(handle);
  if (!isfinite(index) || !isfinite(component) || index < 0 || index >= relative->count || index != floor(index)
      || component < 0 || component > 2 || component != floor(component)) return NAN;
  return relative->spans[(int32_t)index * 3 + (int32_t)component];
}
