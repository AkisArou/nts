#include "nts_icu.h"
#include <unicode/ustring.h>
#include <limits.h>
#include <stdlib.h>

NtsString *nts_icu_string_case(NtsString *locale, NtsString *input, bool upper) {
  if (!nts_icu_versions_match() || input->length > INT32_MAX) return NULL;
  for (uint32_t index = 0; index < locale->length; index++)
    if (nts_unit(locale, index) == 0 || nts_unit(locale, index) > 127) return NULL;
  const char *name = nts_string_to_cstring(locale);
  // This managed ABI carries a length, so embedded NUL is text. The foreign
  // NUL-terminated string helper intentionally rejects it and is unsuitable.
  UChar input_local[128];
  UChar *expanded = NULL;
  const UChar *source;
  if (input->flags & NTS_TWO_BYTE) {
    source = NTS_ELEMENTS(input, UChar);
  } else {
    UChar *units = input_local;
    if (input->length > 128) {
      expanded = malloc((size_t)input->length * sizeof(UChar));
      if (expanded == NULL) { nts_cstring_release(locale, name); return NULL; }
      units = expanded;
    }
    const uint8_t *bytes = NTS_ELEMENTS(input, uint8_t);
    for (uint32_t index = 0; index < input->length; index++) units[index] = bytes[index];
    source = units;
  }
  UChar local[128];
  UChar *output = local;
  UErrorCode status = U_ZERO_ERROR;
  int32_t length = upper
      ? u_strToUpper(local, 128, source, (int32_t)input->length, name, &status)
      : u_strToLower(local, 128, source, (int32_t)input->length, name, &status);
  // Short strings take one ICU pass and need no temporary heap output. Retry
  // expansion/long strings with the exact required length, without truncation.
  if (status == U_BUFFER_OVERFLOW_ERROR && length > 0) {
    output = malloc((size_t)length * sizeof(UChar));
    if (output != NULL) {
      status = U_ZERO_ERROR;
      length = upper
          ? u_strToUpper(output, length, source, (int32_t)input->length, name, &status)
          : u_strToLower(output, length, source, (int32_t)input->length, name, &status);
    }
  }
  NtsString *result = U_SUCCESS(status) && length >= 0
      ? nts_str_alloc(output, (uint32_t)length) : NULL;
  if (output != local) free(output);
  free(expanded);
  nts_cstring_release(locale, name);
  return result;
}
