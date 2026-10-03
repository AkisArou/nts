#include "nts_icu.h"
#include <unicode/ucal.h>
#include <unicode/ucurr.h>
#include <unicode/ulocdata.h>
#include <unicode/uversion.h>
#include <unicode/unumberformatter.h>
#include <unicode/ufieldpositer.h>
#include <stdlib.h>

bool nts_icu_versions_match(void) {
  UVersionInfo icu, unicode, cldr;
  UErrorCode status = U_ZERO_ERROR;
  u_getVersion(icu);
  u_getUnicodeVersion(unicode);
  ulocdata_getCLDRVersion(cldr, &status);
  const char *tzdb = ucal_getTZDataVersion(&status);
  return U_SUCCESS(status) && icu[0] == 78 && icu[1] == 3 &&
         unicode[0] == 17 && unicode[1] == 0 && cldr[0] == 48 &&
         cldr[1] == 0 && tzdb != NULL && strcmp(tzdb, "2026a") == 0;
}

static void close_calendar(void *calendar, size_t data) {
  (void)data;
  ucal_close((UCalendar *)calendar);
}

static void *icu_state(NtsHeader *handle, void (*owner)(void *, size_t)) {
  // Provenance is carried by the native box's destructor. This check also
  // survives NDEBUG; a different managed reference must never be reinterpreted
  // as ICU state. No extra tag or payload allocation is needed.
  if (handle == NULL || handle->descriptor == NULL ||
      handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = (NtsBoxed *)handle;
  if (box->free != owner || box->boxed == NULL) abort();
  return box->boxed;
}

static UCalendar *calendar(NtsHeader *handle) {
  return icu_state(handle, close_calendar);
}

NtsHeader *nts_icu_timezone_open(NtsString *id) {
  if (!nts_icu_versions_match()) return NULL;
  // IANA zone identifiers are ASCII and much shorter than this bound. An
  // explicit length avoids the runtime's C-string conversion (which rejects
  // embedded NUL by terminating the process rather than returning invalid).
  if (id->length == 0 || id->length >= 256) return NULL;
  UChar units[256], canonical[256];
  for (uint32_t i = 0; i < id->length; i++) units[i] = nts_unit(id, i);
  UErrorCode status = U_ZERO_ERROR;
  UBool system = false;
  int32_t length = ucal_getCanonicalTimeZoneID(units, (int32_t)id->length,
      canonical, 256, &system, &status);
  if (U_FAILURE(status) || !system) return NULL;
  UCalendar *cal = ucal_open(canonical, length, "en_US@calendar=iso8601", UCAL_DEFAULT, &status);
  if (U_FAILURE(status)) { if (cal != NULL) ucal_close(cal); return NULL; }
  return nts_boxed_new(cal, close_calendar, 0);
}

NtsString *nts_icu_timezone_id(NtsHeader *handle) {
  UChar units[256];
  UErrorCode status = U_ZERO_ERROR;
  int32_t length = ucal_getTimeZoneID(calendar(handle), units, 256, &status);
  return U_SUCCESS(status) ? nts_str_alloc(units, (uint32_t)length) : NULL;
}

double nts_icu_timezone_offset(NtsHeader *handle, double epoch_ms) {
  if (!isfinite(epoch_ms)) return NAN;
  UCalendar *cal = calendar(handle);
  UErrorCode status = U_ZERO_ERROR;
  ucal_setMillis(cal, floor(epoch_ms), &status);
  int32_t raw = ucal_get(cal, UCAL_ZONE_OFFSET, &status);
  int32_t dst = ucal_get(cal, UCAL_DST_OFFSET, &status);
  return U_SUCCESS(status) ? (double)raw + dst : NAN;
}

double nts_icu_timezone_local_offset(NtsHeader *handle, double local_ms, bool former) {
  if (!isfinite(local_ms)) return NAN;
  UCalendar *cal = calendar(handle);
  UErrorCode status = U_ZERO_ERROR;
  int32_t raw = 0, dst = 0;
  UTimeZoneLocalOption option = former ? UCAL_TZ_LOCAL_FORMER : UCAL_TZ_LOCAL_LATTER;
  ucal_setMillis(cal, floor(local_ms), &status);
  ucal_getTimeZoneOffsetFromLocal(cal, option, option, &raw, &dst, &status);
  return U_SUCCESS(status) ? (double)raw + dst : NAN;
}

double nts_icu_timezone_transition(NtsHeader *handle, double epoch_ms, bool forward) {
  if (!isfinite(epoch_ms)) return NAN;
  UCalendar *cal = calendar(handle);
  UErrorCode status = U_ZERO_ERROR;
  UDate result = 0;
  ucal_setMillis(cal, floor(epoch_ms), &status);
  UBool found = ucal_getTimeZoneTransitionDate(cal,
      forward ? UCAL_TZ_TRANSITION_NEXT : UCAL_TZ_TRANSITION_PREVIOUS, &result, &status);
  return U_SUCCESS(status) && found ? result : NAN;
}

typedef struct NtsIcuNumber {
  UNumberFormatter *formatter;
  UFormattedNumber *result;
  UFieldPositionIterator *iterator;
  int32_t *spans;
  int32_t count;
  int32_t capacity;
} NtsIcuNumber;

double nts_icu_currency_digits(NtsString *currency) {
  if (!nts_icu_versions_match() || currency->length != 3) return NAN;
  UChar code[4];
  for (uint32_t i = 0; i < 3; i++) {
    code[i] = nts_unit(currency, i);
    if (code[i] < 'A' || code[i] > 'Z') return NAN;
  }
  code[3] = 0;
  UErrorCode status = U_ZERO_ERROR;
  int32_t digits = ucurr_getDefaultFractionDigits(code, &status);
  return U_SUCCESS(status) && digits >= 0 ? digits : 2;
}

static void close_number(void *state, size_t data) {
  (void)data;
  NtsIcuNumber *number = state;
  if (number->formatter != NULL) unumf_close(number->formatter);
  if (number->result != NULL) unumf_closeResult(number->result);
  if (number->iterator != NULL) ufieldpositer_close(number->iterator);
  free(number->spans);
  free(number);
}

NtsHeader *nts_icu_number_open(NtsString *locale, NtsString *skeleton) {
  if (!nts_icu_versions_match()) return NULL;
  for (uint32_t i = 0; i < locale->length; i++)
    if (nts_unit(locale, i) == 0) return NULL;
  NtsIcuNumber *number = calloc(1, sizeof(*number));
  if (number == NULL) abort();
  const UChar *units = nts_string_to_utf16(skeleton);
  const char *locale_name = nts_string_to_cstring(locale);
  UErrorCode status = U_ZERO_ERROR;
  number->formatter = unumf_openForSkeletonAndLocale(units, (int32_t)skeleton->length, locale_name, &status);
  nts_utf16_release(skeleton, units);
  nts_cstring_release(locale, locale_name);
  number->result = unumf_openResult(&status);
  number->iterator = ufieldpositer_open(&status);
  if (U_FAILURE(status)) { close_number(number, 0); return NULL; }
  return nts_boxed_new(number, close_number, 0);
}

static NtsIcuNumber *number_state(NtsHeader *handle) {
  return icu_state(handle, close_number);
}

static NtsString *finish_number(NtsIcuNumber *number, bool fields, UErrorCode *status) {
  number->count = 0;
  if (U_FAILURE(*status)) return NULL;
  if (fields) {
    unumf_resultGetAllFieldPositions(number->result, number->iterator, status);
    int32_t start, end, field;
    while ((field = ufieldpositer_next(number->iterator, &start, &end)) >= 0) {
      if (number->count == number->capacity) {
        int32_t capacity = number->capacity == 0 ? 16 : number->capacity * 2;
        int32_t *spans = realloc(number->spans, (size_t)capacity * 3 * sizeof(*spans));
        if (spans == NULL) abort();
        number->spans = spans;
        number->capacity = capacity;
      }
      number->spans[number->count * 3] = field;
      number->spans[number->count * 3 + 1] = start;
      number->spans[number->count * 3 + 2] = end;
      number->count++;
    }
  }
  int32_t length = 0;
  const UFormattedValue *value = unumf_resultAsValue(number->result, status);
  const UChar *text = ufmtval_getString(value, &length, status);
  return U_SUCCESS(*status) ? nts_str_alloc(text, (uint32_t)length) : NULL;
}

NtsString *nts_icu_number_format(NtsHeader *handle, double value, bool fields) {
  NtsIcuNumber *number = number_state(handle);
  UErrorCode status = U_ZERO_ERROR;
  unumf_formatDouble(number->formatter, value, number->result, &status);
  return finish_number(number, fields, &status);
}

NtsString *nts_icu_number_decimal(NtsHeader *handle, NtsString *value, bool fields) {
  NtsIcuNumber *number = number_state(handle);
  UErrorCode status = U_ZERO_ERROR;
  for (uint32_t i = 0; i < value->length; i++)
    if (nts_unit(value, i) == 0) return NULL;
  const char *decimal = nts_string_to_cstring(value);
  unumf_formatDecimal(number->formatter, decimal, (int32_t)value->length, number->result, &status);
  nts_cstring_release(value, decimal);
  return finish_number(number, fields, &status);
}

double nts_icu_number_field_count(NtsHeader *handle) { return number_state(handle)->count; }

double nts_icu_number_field(NtsHeader *handle, double index, double component) {
  NtsIcuNumber *number = number_state(handle);
  if (!isfinite(index) || index < 0 || index >= number->count || index != floor(index) ||
      !isfinite(component) || component < 0 || component >= 3 || component != floor(component)) return NAN;
  return number->spans[(int32_t)index * 3 + (int32_t)component];
}
