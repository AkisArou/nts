extern "C" {
#include "nts_icu.h"
}
#include <unicode/numberrangeformatter.h>
#include <unicode/plurrule.h>
#include <unicode/uformattedvalue.h>
#include <unicode/unumberformatter.h>
#include <unicode/uenum.h>
#include <unicode/upluralrules.h>
#include <array>
#include <memory>
#include <optional>
#include <string>

// Public C results are reused for scalar selection. Public C++ range support
// is opened lazily because it can configure the two endpoints independently.
struct PluralRanges {
  std::unique_ptr<icu::PluralRules> rules;
  icu::number::UnlocalizedNumberFormatter positive, negative;
  std::array<std::optional<icu::number::LocalizedNumberRangeFormatter>, 4> formatters;
};

struct PluralState {
  UPluralRules *rules = nullptr;
  UNumberFormatter *positive = nullptr, *negative = nullptr;
  UFormattedNumber *result = nullptr, *second = nullptr;
  std::string locale, skeleton, negativeSkeleton;
  bool ordinal = false;
  int32_t categories = 0;
  std::unique_ptr<PluralRanges> ranges;
  ~PluralState() {
    if (rules != nullptr) uplrules_close(rules);
    if (positive != nullptr) unumf_close(positive);
    if (negative != nullptr) unumf_close(negative);
    if (result != nullptr) unumf_closeResult(result);
    if (second != nullptr) unumf_closeResult(second);
  }
};

static bool ascii(NtsString *input, std::string &output) {
  output.reserve(input->length);
  for (uint32_t index = 0; index < input->length; index++) {
    const uint16_t unit = nts_unit(input, index);
    if (unit == 0 || unit > 127) return false;
    output.push_back(static_cast<char>(unit));
  }
  return true;
}

static void close_plural(void *state, size_t data) {
  (void)data;
  delete static_cast<PluralState *>(state);
}

static PluralState *plural_state(NtsHeader *handle) {
  if (handle == nullptr || handle->descriptor == nullptr || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = reinterpret_cast<NtsBoxed *>(handle);
  if (box->free != close_plural || box->boxed == nullptr) abort();
  return static_cast<PluralState *>(box->boxed);
}

static int32_t category_code(const char16_t *keyword, int32_t length) {
  constexpr const char16_t *categories[] = {u"zero", u"one", u"two", u"few", u"many", u"other"};
  constexpr int32_t lengths[] = {4, 3, 3, 3, 4, 5};
  for (int32_t index = 0; index < 6; index++)
    if (length == lengths[index] && memcmp(keyword, categories[index], static_cast<size_t>(length) * sizeof(*keyword)) == 0) return index;
  return -1;
}

static UNumberFormatter *number_formatter(const std::string &skeleton, const std::string &locale, UErrorCode &status) {
  const icu::UnicodeString units = icu::UnicodeString::fromUTF8(skeleton);
  return unumf_openForSkeletonAndLocale(units.getBuffer(), units.length(), locale.c_str(), &status);
}

extern "C" NtsHeader *nts_icu_plural_open(NtsString *locale, bool ordinal, NtsString *skeleton, NtsString *negative_skeleton) {
  if (!nts_icu_versions_match()) return nullptr;
  auto state = std::make_unique<PluralState>();
  if (!ascii(locale, state->locale) || !ascii(skeleton, state->skeleton) || !ascii(negative_skeleton, state->negativeSkeleton)) return nullptr;
  state->ordinal = ordinal;
  UErrorCode status = U_ZERO_ERROR;
  state->rules = uplrules_openForType(state->locale.c_str(), ordinal ? UPLURAL_TYPE_ORDINAL : UPLURAL_TYPE_CARDINAL, &status);
  state->positive = number_formatter(state->skeleton, state->locale, status);
  if (!state->negativeSkeleton.empty()) state->negative = number_formatter(state->negativeSkeleton, state->locale, status);
  state->result = unumf_openResult(&status);
  UEnumeration *keywords = uplrules_getKeywords(state->rules, &status);
  if (keywords != nullptr) {
    int32_t length = 0;
    const char16_t *keyword;
    while ((keyword = uenum_unext(keywords, &length, &status)) != nullptr) {
      const int32_t code = category_code(keyword, length);
      if (code < 0) { status = U_INVALID_FORMAT_ERROR; break; }
      state->categories |= 1 << code;
    }
    uenum_close(keywords);
  }
  if (U_FAILURE(status) || (state->categories & 32) == 0) return nullptr;
  return nts_boxed_new(state.release(), close_plural, 0);
}

static double formatted_category(PluralState *state, UFormattedNumber *number, UErrorCode &status) {
  char16_t keyword[6];
  const int32_t length = uplrules_selectFormatted(state->rules, number, keyword, 6, &status);
  if (U_FAILURE(status)) return NAN;
  const int32_t code = category_code(keyword, length);
  return code < 0 ? NAN : code;
}

static UNumberFormatter *formatter(PluralState *state, bool negative) {
  return negative && state->negative != nullptr ? state->negative : state->positive;
}

extern "C" double nts_icu_plural_categories(NtsHeader *handle) { return plural_state(handle)->categories; }

extern "C" double nts_icu_plural_select(NtsHeader *handle, double value, bool negative) {
  PluralState *state = plural_state(handle);
  if (!isfinite(value)) return 5;
  UErrorCode status = U_ZERO_ERROR;
  unumf_formatDouble(formatter(state, negative), value, state->result, &status);
  return formatted_category(state, state->result, status);
}

extern "C" double nts_icu_plural_decimal(NtsHeader *handle, NtsString *value, bool negative) {
  PluralState *state = plural_state(handle);
  for (uint32_t index = 0; index < value->length; index++)
    if (nts_unit(value, index) == 0 || nts_unit(value, index) > 127) return NAN;
  const char *text = nts_string_to_cstring(value);
  UErrorCode status = U_ZERO_ERROR;
  unumf_formatDecimal(formatter(state, negative), text, static_cast<int32_t>(value->length), state->result, &status);
  nts_cstring_release(value, text);
  return formatted_category(state, state->result, status);
}

static void format_decimal(PluralState *state, const std::string &value, bool negative, UFormattedNumber *result, UErrorCode &status) {
  if (value == "Infinity" || value == "-Infinity")
    unumf_formatDouble(formatter(state, negative), value.front() == '-' ? -INFINITY : INFINITY, result, &status);
  else unumf_formatDecimal(formatter(state, negative), value.c_str(), static_cast<int32_t>(value.length()), result, &status);
}

static icu::Formattable range_number(const std::string &value, UErrorCode &status) {
  if (value == "Infinity" || value == "-Infinity") return icu::Formattable(value.front() == '-' ? -INFINITY : INFINITY);
  return icu::Formattable(icu::StringPiece(value), status);
}

extern "C" double nts_icu_plural_range(NtsHeader *handle, NtsString *start, NtsString *end, bool negative_start, bool negative_end) {
  PluralState *state = plural_state(handle);
  std::string first, last;
  if (!ascii(start, first) || !ascii(end, last)) return NAN;
  UErrorCode status = U_ZERO_ERROR;
  format_decimal(state, first, negative_start, state->result, status);
  const double first_category = formatted_category(state, state->result, status);
  if (U_FAILURE(status) || isnan(first_category)) return NAN;
  if (first == last && formatter(state, negative_start) == formatter(state, negative_end)) return first_category;
  if (state->ranges == nullptr) {
    auto ranges = std::make_unique<PluralRanges>();
    const icu::Locale locale = icu::Locale::forLanguageTag(state->locale, status);
    ranges->rules.reset(icu::PluralRules::forLocale(locale, state->ordinal ? UPLURAL_TYPE_ORDINAL : UPLURAL_TYPE_CARDINAL, status));
    ranges->positive = icu::number::NumberFormatter::forSkeleton(icu::UnicodeString::fromUTF8(state->skeleton), status);
    ranges->negative = state->negativeSkeleton.empty() ? ranges->positive : icu::number::NumberFormatter::forSkeleton(icu::UnicodeString::fromUTF8(state->negativeSkeleton), status);
    if (U_FAILURE(status)) return NAN;
    state->ranges = std::move(ranges);
  }
  PluralRanges *ranges = state->ranges.get();
  const int32_t key = state->negativeSkeleton.empty() ? 0 : (negative_start ? 1 : 0) + (negative_end ? 2 : 0);
  if (!ranges->formatters[key].has_value()) {
    auto configuration = icu::number::NumberRangeFormatter::with();
    configuration = key == 0 || key == 3 ? configuration.numberFormatterBoth(key == 3 ? ranges->negative : ranges->positive) : configuration
        .numberFormatterFirst(key % 2 == 1 ? ranges->negative : ranges->positive)
        .numberFormatterSecond(key >= 2 ? ranges->negative : ranges->positive);
    ranges->formatters[key] = configuration.collapse(UNUM_RANGE_COLLAPSE_NONE).identityFallback(UNUM_IDENTITY_FALLBACK_RANGE)
        .locale(icu::Locale::forLanguageTag(state->locale, status));
  }
  const icu::Formattable from = range_number(first, status), to = range_number(last, status);
  const auto result = ranges->formatters[key]->formatFormattableRange(from, to, status);
  const icu::UnicodeString category = ranges->rules->select(result, status);
  if (U_FAILURE(status)) return NAN;
  const int32_t code = category_code(category.getBuffer(), category.length());
  if (code < 0) return NAN;
  // ResolvePluralRange has two branches. If both categories agree, the text
  // identity test cannot change the answer and needs no second scalar result.
  if (code == first_category) return code;
  if (state->second == nullptr) state->second = unumf_openResult(&status);
  format_decimal(state, last, negative_end, state->second, status);
  int32_t first_length = 0, last_length = 0;
  const UChar *first_text = ufmtval_getString(unumf_resultAsValue(state->result, &status), &first_length, &status);
  const UChar *last_text = ufmtval_getString(unumf_resultAsValue(state->second, &status), &last_length, &status);
  if (U_FAILURE(status)) return NAN;
  return first_length == last_length && memcmp(first_text, last_text, static_cast<size_t>(first_length) * sizeof(*first_text)) == 0 ? first_category : code;
}
