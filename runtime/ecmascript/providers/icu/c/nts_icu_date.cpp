extern "C" {
#include "nts_icu.h"
}
#include <unicode/smpdtfmt.h>
#include <unicode/gregocal.h>
#include <unicode/fpositer.h>
#include <unicode/timezone.h>
#include <unicode/udat.h>
#include <unicode/dtitvfmt.h>
#include <unicode/dtptngen.h>
#include <unicode/uformattedvalue.h>
#include <memory>
#include <string>
#include <vector>

struct DateSpan { int32_t field, start, end; };
struct DateFormatter {
  icu::SimpleDateFormat formatter;
  icu::Locale locale;
  icu::UnicodeString text;
  icu::FieldPositionIterator positions;
  std::vector<DateSpan> spans;
  std::unique_ptr<icu::DateIntervalFormat> range;
  std::unique_ptr<icu::Calendar> from, to;
  icu::ConstrainedFieldPosition range_position;
  DateFormatter(const icu::UnicodeString &pattern, const icu::Locale &locale, UErrorCode &status)
      : formatter(pattern, locale, status), locale(locale) { spans.reserve(16); }
};
static void close_date(void *state, size_t data) { (void)data; delete static_cast<DateFormatter *>(state); }
static DateFormatter *date_state(NtsHeader *handle) {
  if (handle == nullptr || handle->descriptor == nullptr || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = reinterpret_cast<NtsBoxed *>(handle);
  if (box->free != close_date || box->boxed == nullptr) abort();
  return static_cast<DateFormatter *>(box->boxed);
}
static bool ascii(NtsString *input, std::string &output) {
  output.reserve(input->length);
  for (uint32_t index = 0; index < input->length; index++) {
    const uint16_t unit = nts_unit(input, index);
    if (unit == 0 || unit > 127) return false;
    output.push_back(static_cast<char>(unit));
  }
  return true;
}
static int32_t field_code(int32_t field) {
  switch (field) {
    case UDAT_ERA_FIELD: return 0;
    case UDAT_YEAR_FIELD: case UDAT_EXTENDED_YEAR_FIELD: return 1;
    case UDAT_MONTH_FIELD: case UDAT_STANDALONE_MONTH_FIELD: return 2;
    case UDAT_DATE_FIELD: return 3;
    case UDAT_HOUR_OF_DAY1_FIELD: case UDAT_HOUR_OF_DAY0_FIELD: case UDAT_HOUR1_FIELD: case UDAT_HOUR0_FIELD: return 4;
    case UDAT_MINUTE_FIELD: return 5;
    case UDAT_SECOND_FIELD: return 6;
    case UDAT_FRACTIONAL_SECOND_FIELD: return 7;
    case UDAT_DAY_OF_WEEK_FIELD: case UDAT_DOW_LOCAL_FIELD: case UDAT_STANDALONE_DAY_FIELD: return 8;
    case UDAT_AM_PM_FIELD: case UDAT_AM_PM_MIDNIGHT_NOON_FIELD: case UDAT_FLEXIBLE_DAY_PERIOD_FIELD: return 9;
    case UDAT_TIMEZONE_FIELD: case UDAT_TIMEZONE_RFC_FIELD: case UDAT_TIMEZONE_GENERIC_FIELD: case UDAT_TIMEZONE_SPECIAL_FIELD:
    case UDAT_TIMEZONE_LOCALIZED_GMT_OFFSET_FIELD: case UDAT_TIMEZONE_ISO_FIELD: case UDAT_TIMEZONE_ISO_LOCAL_FIELD: return 10;
    case UDAT_RELATED_YEAR_FIELD: return 11;
    case UDAT_YEAR_NAME_FIELD: return 12;
    case UDAT_TIME_SEPARATOR_FIELD: return -1;
    default: return 13;
  }
}

extern "C" NtsHeader *nts_icu_date_open(NtsString *locale, NtsString *pattern, NtsString *time_zone) {
  if (!nts_icu_versions_match() || pattern->length > INT32_MAX) return nullptr;
  std::string tag, zone_id;
  if (!ascii(locale, tag) || !ascii(time_zone, zone_id)) return nullptr;
  if (!zone_id.empty() && (zone_id[0] == '+' || zone_id[0] == '-')) zone_id.insert(0, "GMT");
  auto zone = std::unique_ptr<icu::TimeZone>(icu::TimeZone::createTimeZone(icu::UnicodeString::fromUTF8(zone_id)));
  icu::UnicodeString actual_id;
  zone->getID(actual_id);
  if (actual_id == icu::UnicodeString("Etc/Unknown")) return nullptr;
  icu::UnicodeString selected;
  for (uint32_t index = 0; index < pattern->length; index++) selected.append(static_cast<char16_t>(nts_unit(pattern, index)));
  UErrorCode status = U_ZERO_ERROR;
  const icu::Locale data_locale = icu::Locale::forLanguageTag(tag, status);
  auto state = std::make_unique<DateFormatter>(selected, data_locale, status);
  if (U_FAILURE(status)) return nullptr;
  state->formatter.setTimeZone(*zone);
  auto calendar = std::unique_ptr<icu::Calendar>(state->formatter.getCalendar()->clone());
  // Move the cutover below ECMAScript's entire time domain, including a local
  // offset near its minimum. Gregorian fields must never use Julian dates.
  if (auto gregorian = dynamic_cast<icu::GregorianCalendar *>(calendar.get()))
    gregorian->setGregorianChange(-9007199254740992.0, status);
  if (U_FAILURE(status)) return nullptr;
  state->formatter.adoptCalendar(calendar.release());
  return nts_boxed_new(state.release(), close_date, 0);
}

static NtsString *date_text(DateFormatter *state) {
  bool wide = false;
  for (int32_t index = 0; index < state->text.length(); index++)
    if (state->text.charAt(index) > 255) { wide = true; break; }
  NtsString *result = nts_str_raw(static_cast<uint32_t>(state->text.length()), wide ? 1 : 0);
  if (wide) {
    uint16_t *output = NTS_ELEMENTS(result, uint16_t);
    for (int32_t index = 0; index < state->text.length(); index++) output[index] = state->text.charAt(index);
  } else {
    uint8_t *output = NTS_ELEMENTS(result, uint8_t);
    for (int32_t index = 0; index < state->text.length(); index++) output[index] = static_cast<uint8_t>(state->text.charAt(index));
  }
  return result;
}
extern "C" NtsString *nts_icu_date_format(NtsHeader *handle, double milliseconds, bool fields) {
  if (!isfinite(milliseconds)) return nullptr;
  DateFormatter *state = date_state(handle);
  state->text.remove();
  state->spans.clear();
  UErrorCode status = U_ZERO_ERROR;
  state->formatter.format(milliseconds, state->text, fields ? &state->positions : nullptr, status);
  if (U_FAILURE(status)) return nullptr;
  if (fields) {
    icu::FieldPosition position;
    while (state->positions.next(position)) {
      const int32_t field = field_code(position.getField());
      if (field >= 0) state->spans.push_back({field, position.getBeginIndex(), position.getEndIndex()});
    }
  }
  return date_text(state);
}
extern "C" NtsString *nts_icu_date_range(NtsHeader *handle, double start, double end, bool fields) {
  if (!isfinite(start) || !isfinite(end)) return nullptr;
  DateFormatter *state = date_state(handle);
  UErrorCode status = U_ZERO_ERROR;
  if (!state->range) {
    icu::UnicodeString pattern;
    state->formatter.toPattern(pattern);
    const icu::UnicodeString skeleton = icu::DateTimePatternGenerator::staticGetSkeleton(pattern, status);
    state->range.reset(icu::DateIntervalFormat::createInstance(skeleton, state->locale, status));
    if (U_FAILURE(status) || !state->range) { state->range.reset(); return nullptr; }
    state->range->setTimeZone(state->formatter.getTimeZone());
    state->from.reset(state->formatter.getCalendar()->clone());
    state->to.reset(state->formatter.getCalendar()->clone());
  }
  state->from->setTime(start, status);
  state->to->setTime(end, status);
  auto result = state->range->formatToValue(*state->from, *state->to, status);
  state->spans.clear();
  state->range_position.reset();
  if (!fields) state->range_position.constrainCategory(UFIELD_CATEGORY_DATE_INTERVAL_SPAN);
  bool range = false;
  while (result.nextPosition(state->range_position, status)) {
    const int32_t category = state->range_position.getCategory();
    int32_t field;
    if (category == UFIELD_CATEGORY_DATE_INTERVAL_SPAN) {
      field = 14 + state->range_position.getField();
      range = true;
    } else if (category == UFIELD_CATEGORY_DATE) field = field_code(state->range_position.getField());
    else continue;
    if (fields && field >= 0) state->spans.push_back({field, state->range_position.getStart(), state->range_position.getLimit()});
  }
  if (U_FAILURE(status)) return nullptr;
  // ICU identifies equal displayed calendar fields. Render that identity with
  // the selected single-date pattern, including style punctuation and widths.
  if (!range) return nts_icu_date_format(handle, start, fields);
  state->text = result.toString(status);
  return U_SUCCESS(status) ? date_text(state) : nullptr;
}
extern "C" double nts_icu_date_field_count(NtsHeader *handle) { return date_state(handle)->spans.size(); }
extern "C" double nts_icu_date_field(NtsHeader *handle, double index, double component) {
  DateFormatter *state = date_state(handle);
  if (!isfinite(index) || index < 0 || index >= state->spans.size() || index != floor(index)) return NAN;
  const DateSpan &span = state->spans[static_cast<size_t>(index)];
  if (component == 0) return span.field;
  if (component == 1) return span.start;
  if (component == 2) return span.end;
  return NAN;
}
