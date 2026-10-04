extern "C" {
#include "nts_icu.h"
}
#include <unicode/locid.h>
#include <unicode/udat.h>
#include <unicode/udatpg.h>
#include <unicode/uenum.h>
#include <memory>
#include <string>
#include <vector>

using Generator = std::unique_ptr<UDateTimePatternGenerator, decltype(&udatpg_close)>;

struct DatePatterns {
  std::string locale;
  Generator generator;
  std::vector<UChar> skeleton;
  std::vector<UChar> output;
  DatePatterns(std::string name, UErrorCode &status)
      : locale(std::move(name)), generator(udatpg_open(locale.c_str(), &status), udatpg_close), skeleton(32), output(128) {}
};
static void close_patterns(void *state, size_t data) { (void)data; delete static_cast<DatePatterns *>(state); }
static DatePatterns *pattern_state(NtsHeader *handle) {
  if (handle == nullptr || handle->descriptor == nullptr || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = reinterpret_cast<NtsBoxed *>(handle);
  if (box->free != close_patterns || box->boxed == nullptr) abort();
  return static_cast<DatePatterns *>(box->boxed);
}
static NtsString *pattern_result(const UChar *units, int32_t length) {
  // UChar is char16_t in this C++ build; write the runtime's uint16_t storage
  // directly rather than aliasing it or allocating another conversion buffer.
  NtsString *result = nts_str_raw(static_cast<uint32_t>(length), 1);
  uint16_t *output = NTS_ELEMENTS(result, uint16_t);
  for (int32_t index = 0; index < length; index++) output[index] = units[index];
  return result;
}

extern "C" NtsHeader *nts_icu_date_patterns_open(NtsString *tag) {
  if (!nts_icu_versions_match()) return nullptr;
  std::string text;
  text.reserve(tag->length);
  for (uint32_t index = 0; index < tag->length; index++) {
    const uint16_t unit = nts_unit(tag, index);
    if (unit == 0 || unit > 127) return nullptr;
    text.push_back(static_cast<char>(unit));
  }
  UErrorCode status = U_ZERO_ERROR;
  const icu::Locale locale = icu::Locale::forLanguageTag(text, status);
  if (U_FAILURE(status)) return nullptr;
  auto state = std::make_unique<DatePatterns>(locale.getName(), status);
  if (U_FAILURE(status) || !state->generator) return nullptr;
  return nts_boxed_new(state.release(), close_patterns, 0);
}

extern "C" NtsString *nts_icu_date_best_pattern(NtsHeader *handle, NtsString *skeleton) {
  DatePatterns *state = pattern_state(handle);
  // Construction-time input conversion; the generator and output buffer are
  // reused for the environment's selected locale/calendar/numbering system.
  if (skeleton->length > INT32_MAX) return nullptr;
  if (state->skeleton.size() < skeleton->length) state->skeleton.resize(skeleton->length);
  for (uint32_t index = 0; index < skeleton->length; index++) state->skeleton[index] = nts_unit(skeleton, index);
  UErrorCode status = U_ZERO_ERROR;
  int32_t length = udatpg_getBestPatternWithOptions(state->generator.get(), state->skeleton.data(), static_cast<int32_t>(skeleton->length),
      UDATPG_MATCH_HOUR_FIELD_LENGTH, state->output.data(), static_cast<int32_t>(state->output.size()), &status);
  if (status == U_BUFFER_OVERFLOW_ERROR) {
    state->output.resize(length + 1);
    status = U_ZERO_ERROR;
    length = udatpg_getBestPatternWithOptions(state->generator.get(), state->skeleton.data(), static_cast<int32_t>(skeleton->length),
        UDATPG_MATCH_HOUR_FIELD_LENGTH, state->output.data(), static_cast<int32_t>(state->output.size()), &status);
  }
  return U_SUCCESS(status) ? pattern_result(state->output.data(), length) : nullptr;
}

extern "C" NtsString *nts_icu_date_style_pattern(NtsHeader *handle, double date_style, double time_style) {
  if (date_style < -1 || date_style > 3 || date_style != floor(date_style) || time_style < -1 || time_style > 3 ||
      time_style != floor(time_style) || (date_style == -1 && time_style == -1)) return nullptr;
  DatePatterns *state = pattern_state(handle);
  UErrorCode status = U_ZERO_ERROR;
  const UChar utc[] = { 'U', 'T', 'C' };
  std::unique_ptr<UDateFormat, decltype(&udat_close)> format(udat_open(static_cast<UDateFormatStyle>(static_cast<int32_t>(time_style)),
      static_cast<UDateFormatStyle>(static_cast<int32_t>(date_style)), state->locale.c_str(), utc, 3, nullptr, 0, &status), udat_close);
  if (U_FAILURE(status) || !format) return nullptr;
  int32_t length = udat_toPattern(format.get(), false, state->output.data(), static_cast<int32_t>(state->output.size()), &status);
  if (status == U_BUFFER_OVERFLOW_ERROR) {
    state->output.resize(length + 1);
    status = U_ZERO_ERROR;
    length = udat_toPattern(format.get(), false, state->output.data(), static_cast<int32_t>(state->output.size()), &status);
  }
  return U_SUCCESS(status) ? pattern_result(state->output.data(), length) : nullptr;
}

static const NtsDescriptor strings = {
    NTS_KIND_ARRAY, sizeof(NtsString *), 1, 0, nullptr, nullptr, "ICU patterns",
    0, nullptr, NTS_ARRAY_REFERENCE, 0, nullptr};

extern "C" NtsArray *nts_icu_date_patterns(NtsHeader *handle) {
  DatePatterns *state = pattern_state(handle);
  UErrorCode status = U_ZERO_ERROR;
  std::unique_ptr<UEnumeration, decltype(&uenum_close)> enumeration(udatpg_openSkeletons(state->generator.get(), &status), uenum_close);
  if (U_FAILURE(status) || !enumeration) return nullptr;
  const int32_t count = uenum_count(enumeration.get(), &status);
  if (U_FAILURE(status)) return nullptr;
  NtsArray *result = nts_array_new(&strings, count);
  for (int32_t index = 0; index < count; index++) {
    int32_t skeleton_length, length;
    const UChar *skeleton = uenum_unext(enumeration.get(), &skeleton_length, &status);
    const UChar *pattern = skeleton == nullptr ? nullptr : udatpg_getPatternForSkeleton(state->generator.get(), skeleton, skeleton_length, &length);
    if (U_FAILURE(status) || pattern == nullptr) {
      nts_release(reinterpret_cast<NtsHeader *>(result));
      return nullptr;
    }
    NTS_ITEMS(result, NtsString *)[index] = pattern_result(pattern, length);
  }
  return result;
}
