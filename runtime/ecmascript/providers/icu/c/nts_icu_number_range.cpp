extern "C" {
#include "nts_icu.h"
}
#include <unicode/numberrangeformatter.h>
#include <unicode/uformattedvalue.h>
#include <unicode/unum.h>
#include <memory>
#include <string>
#include <vector>

// The C skeleton API cannot configure endpoints independently. This primitive
// uses ICU's public C++ API behind the same managed C ABI; shared TS selects
// the endpoint configurations, including sign-sensitive rounding variants.
struct NumberSpan { int32_t field, start, end; };
struct NumberRange {
  icu::number::LocalizedNumberRangeFormatter formatter;
  icu::ConstrainedFieldPosition position;
  std::vector<NumberSpan> spans;
  std::vector<uint16_t> units;
  explicit NumberRange(icu::number::LocalizedNumberRangeFormatter formatter)
      : formatter(std::move(formatter)) { spans.reserve(16); }
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

static void close_range(void *state, size_t data) {
  (void)data;
  delete static_cast<NumberRange *>(state);
}

static NumberRange *range_state(NtsHeader *handle) {
  if (handle == nullptr || handle->descriptor == nullptr || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = reinterpret_cast<NtsBoxed *>(handle);
  if (box->free != close_range || box->boxed == nullptr) abort();
  return static_cast<NumberRange *>(box->boxed);
}

extern "C" NtsHeader *nts_icu_number_range_open(NtsString *locale, NtsString *start_skeleton, NtsString *end_skeleton) {
  if (!nts_icu_versions_match()) return nullptr;
  std::string tag, first, last;
  if (!ascii(locale, tag) || !ascii(start_skeleton, first) || !ascii(end_skeleton, last)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  auto start = icu::number::NumberFormatter::forSkeleton(icu::UnicodeString::fromUTF8(first), status);
  auto end = icu::number::NumberFormatter::forSkeleton(icu::UnicodeString::fromUTF8(last), status);
  auto configuration = icu::number::NumberRangeFormatter::with();
  configuration = first == last ? configuration.numberFormatterBoth(start) : configuration.numberFormatterFirst(start).numberFormatterSecond(end);
  auto formatter = configuration.identityFallback(UNUM_IDENTITY_FALLBACK_APPROXIMATELY)
      .locale(icu::Locale::forLanguageTag(tag, status));
  if (U_FAILURE(status)) return nullptr;
  return nts_boxed_new(new NumberRange(std::move(formatter)), close_range, 0);
}

extern "C" NtsString *nts_icu_number_range_format(NtsHeader *handle, NtsString *start, NtsString *end, bool fields) {
  NumberRange *range = range_state(handle);
  std::string first, last;
  if (!ascii(start, first) || !ascii(end, last)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const icu::Formattable from(first, status), to(last, status);
  auto result = range->formatter.formatFormattableRange(from, to, status);
  range->spans.clear();
  if (fields) {
    range->position.reset();
    while (result.nextPosition(range->position, status)) {
      const int32_t category = range->position.getCategory();
      int32_t field = range->position.getField();
      if (category == UFIELD_CATEGORY_NUMBER_RANGE_SPAN) field += 14;
      else if (category != UFIELD_CATEGORY_NUMBER) continue;
      range->spans.push_back({field, range->position.getStart(), range->position.getLimit()});
    }
  }
  const icu::UnicodeString text = result.toString(status);
  if (U_FAILURE(status)) return nullptr;
  range->units.resize(static_cast<size_t>(text.length()));
  for (int32_t index = 0; index < text.length(); index++) range->units[index] = text.charAt(index);
  return nts_str_alloc(range->units.data(), static_cast<uint32_t>(text.length()));
}

extern "C" double nts_icu_number_range_field_count(NtsHeader *handle) { return range_state(handle)->spans.size(); }

extern "C" double nts_icu_number_range_field(NtsHeader *handle, double index, double component) {
  NumberRange *range = range_state(handle);
  if (!isfinite(index) || index < 0 || index >= range->spans.size() || index != floor(index)) return NAN;
  const NumberSpan &span = range->spans[static_cast<size_t>(index)];
  if (component == 0) return span.field;
  if (component == 1) return span.start;
  if (component == 2) return span.end;
  return NAN;
}
