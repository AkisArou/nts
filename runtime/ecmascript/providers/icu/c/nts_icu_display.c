#include "nts_icu.h"
#include "nts_icu_currency.h"
#include <unicode/uldnames.h>
#include <unicode/udatpg.h>
#include <unicode/uloc.h>
#include <stdlib.h>

typedef struct {
  ULocaleDisplayNames *names;
  UDateTimePatternGenerator *patterns;
  char *locale, *code;
  int32_t code_capacity;
  UChar *text;
  int32_t capacity;
  int32_t type, style;
} DisplayNames;

static void close_display(void *state, size_t data) {
  (void)data;
  DisplayNames *names = state;
  if (names->names != NULL) uldn_close(names->names);
  if (names->patterns != NULL) udatpg_close(names->patterns);
  free(names->locale);
  free(names->code);
  free(names->text);
  free(names);
}

static DisplayNames *display_state(NtsHeader *handle) {
  if (handle == NULL || handle->descriptor == NULL || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = (NtsBoxed *)handle;
  if (box->free != close_display || box->boxed == NULL) abort();
  return box->boxed;
}

static bool language_id(const char *tag, char **buffer, int32_t *capacity) {
  UErrorCode status = U_ZERO_ERROR;
  int32_t parsed;
  int32_t length = uloc_forLanguageTag(tag, *buffer, *capacity, &parsed, &status);
  if (status == U_BUFFER_OVERFLOW_ERROR || length == *capacity) {
    if (length == INT32_MAX) return false;
    char *next = realloc(*buffer, (size_t)length + 1);
    if (next == NULL) abort();
    *buffer = next;
    *capacity = length + 1;
    status = U_ZERO_ERROR;
    uloc_forLanguageTag(tag, *buffer, *capacity, &parsed, &status);
  }
  return U_SUCCESS(status) && (size_t)parsed == strlen(tag);
}

NtsHeader *nts_icu_display_open(NtsString *locale, double type, double style, bool dialect) {
  if (!nts_icu_versions_match() || !isfinite(type) || type < 0 || type > 5 || type != floor(type)
      || !isfinite(style) || style < 0 || style > 2 || style != floor(style)) return NULL;
  for (uint32_t index = 0; index < locale->length; index++)
    if (nts_unit(locale, index) == 0 || nts_unit(locale, index) > 127) return NULL;
  DisplayNames *names = calloc(1, sizeof(*names));
  if (names == NULL) abort();
  names->type = (int32_t)type;
  names->style = (int32_t)style;
  int32_t capacity = 0;
  const char *tag = nts_string_to_cstring(locale);
  bool valid = language_id(tag, &names->locale, &capacity);
  nts_cstring_release(locale, tag);
  if (!valid) { close_display(names, 0); return NULL; }
  UErrorCode status = U_ZERO_ERROR;
  if (type == 5) names->patterns = udatpg_open(names->locale, &status);
  else {
    UDisplayContext contexts[] = {
      dialect ? UDISPCTX_DIALECT_NAMES : UDISPCTX_STANDARD_NAMES,
      UDISPCTX_CAPITALIZATION_FOR_STANDALONE,
      style == 0 ? UDISPCTX_LENGTH_FULL : UDISPCTX_LENGTH_SHORT,
      UDISPCTX_NO_SUBSTITUTE,
    };
    names->names = uldn_openForContext(names->locale, contexts, 4, &status);
  }
  if (U_FAILURE(status) || (names->names == NULL && names->patterns == NULL)) {
    close_display(names, 0);
    return NULL;
  }
  names->capacity = 128;
  names->text = malloc((size_t)names->capacity * sizeof(*names->text));
  if (names->text == NULL) abort();
  return nts_boxed_new(names, close_display, 0);
}

static int32_t query(DisplayNames *names, const char *code, int32_t field, UErrorCode *status) {
  if (names->type == 0) return uldn_localeDisplayName(names->names, code, names->text, names->capacity, status);
  if (names->type == 1) return uldn_regionDisplayName(names->names, code, names->text, names->capacity, status);
  if (names->type == 2) return uldn_scriptDisplayName(names->names, code, names->text, names->capacity, status);
  if (names->type == 3) return uldn_keyValueDisplayName(names->names, "currency", code, names->text, names->capacity, status);
  if (names->type == 4) {
    const char *legacy = uloc_toLegacyType("calendar", code);
    return uldn_keyValueDisplayName(names->names, "calendar", legacy == NULL ? code : legacy, names->text, names->capacity, status);
  }
  const UDateTimePatternField fields[] = {
    UDATPG_ERA_FIELD, UDATPG_YEAR_FIELD, UDATPG_QUARTER_FIELD, UDATPG_MONTH_FIELD,
    UDATPG_WEEK_OF_YEAR_FIELD, UDATPG_WEEKDAY_FIELD, UDATPG_DAY_FIELD, UDATPG_DAYPERIOD_FIELD,
    UDATPG_HOUR_FIELD, UDATPG_MINUTE_FIELD, UDATPG_SECOND_FIELD, UDATPG_ZONE_FIELD,
  };
  return udatpg_getFieldDisplayName(names->patterns, fields[field], (UDateTimePGDisplayWidth)names->style,
                                  names->text, names->capacity, status);
}

NtsString *nts_icu_display_name(NtsHeader *handle, NtsString *code, double field) {
  DisplayNames *names = display_state(handle);
  if (!isfinite(field) || field != floor(field) || (names->type == 5 ? field < 0 || field > 11 : field != -1)) return NULL;
  for (uint32_t index = 0; index < code->length; index++)
    if (nts_unit(code, index) == 0 || nts_unit(code, index) > 127) return NULL;
  const char *text = nts_string_to_cstring(code);
  const char *key = text;
  if (names->type == 0) {
    if (!language_id(text, &names->code, &names->code_capacity)) {
      nts_cstring_release(code, text);
      return NULL;
    }
    key = names->code;
  } else if (names->type == 3) {
    // ICU4C's LocaleDisplayNames currency path ignores NO_SUBSTITUTE. The
    // public currency API identifies its code fallback explicitly.
    if (code->length != 3) { nts_cstring_release(code, text); return NULL; }
    UChar currency[4] = { nts_unit(code, 0), nts_unit(code, 1), nts_unit(code, 2), 0 };
    if (!currency_name_available(currency, names->locale)) {
      nts_cstring_release(code, text);
      return NULL;
    }
  }
  UErrorCode status = U_ZERO_ERROR;
  int32_t length = query(names, key, (int32_t)field, &status);
  if (status == U_BUFFER_OVERFLOW_ERROR || length == names->capacity) {
    if (length == INT32_MAX) { nts_cstring_release(code, text); return NULL; }
    UChar *next = realloc(names->text, ((size_t)length + 1) * sizeof(*next));
    if (next == NULL) abort();
    names->text = next;
    names->capacity = length + 1;
    status = U_ZERO_ERROR;
    length = query(names, key, (int32_t)field, &status);
  }
  nts_cstring_release(code, text);
  return U_SUCCESS(status) && length > 0 ? nts_str_alloc(names->text, (uint32_t)length) : NULL;
}
