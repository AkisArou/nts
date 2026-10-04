#ifndef NTS_ICU_CURRENCY_H
#define NTS_ICU_CURRENCY_H
#include <unicode/ucurr.h>

// ucurr_getName reports an unknown currency by returning its code with a
// default-data warning. An equal string without that warning is real data.
static inline bool currency_name_available(const UChar *currency, const char *locale) {
  UErrorCode status = U_ZERO_ERROR;
  int32_t length;
  const UChar *name = ucurr_getName(currency, locale, UCURR_LONG_NAME, NULL, &length, &status);
  return U_SUCCESS(status) && name != NULL
      && !(status == U_USING_DEFAULT_WARNING && length == 3
          && name[0] == currency[0] && name[1] == currency[1] && name[2] == currency[2]);
}
#endif
