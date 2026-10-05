#ifndef NTS_ICU_TEXT_H
#define NTS_ICU_TEXT_H

extern "C" {
#include "nts_runtime.h"
}
#include <unicode/unistr.h>

// Copy explicit UTF-16 units directly into the managed string. Preserve NULs
// and lone surrogates, and choose narrow storage only for Latin-1 text.
static inline NtsString *nts_icu_copy_text(const icu::UnicodeString &text) {
  const int32_t length = text.length();
  bool wide = false;
  for (int32_t index = 0; index < length; index++)
    if (text.charAt(index) > 255) { wide = true; break; }
  NtsString *result = nts_str_raw(static_cast<uint32_t>(length), wide ? 1 : 0);
  if (wide) {
    uint16_t *output = NTS_ELEMENTS(result, uint16_t);
    for (int32_t index = 0; index < length; index++) output[index] = text.charAt(index);
  } else {
    uint8_t *output = NTS_ELEMENTS(result, uint8_t);
    for (int32_t index = 0; index < length; index++) output[index] = static_cast<uint8_t>(text.charAt(index));
  }
  return result;
}

#endif
