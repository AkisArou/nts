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
#include <cstring>
#include <string>
#include <vector>

struct DateSpan { int32_t field, start, end; };
struct DateFieldLocator {
  icu::UnicodeString marker_pattern, field_pattern;
  int32_t marker;
  std::unique_ptr<icu::SimpleDateFormat> marker_formatter, field_formatter;
  DateFieldLocator(icu::UnicodeString marker_pattern, icu::UnicodeString field_pattern, int32_t marker)
      : marker_pattern(std::move(marker_pattern)), field_pattern(std::move(field_pattern)), marker(marker) {}
};
// Presentation adapter, not a second calendar engine. Gregorian computes the
// actual instant's time/weekday; shared TS supplies every lunisolar date field.
class CalendarFields final : public icu::GregorianCalendar {
  std::string type;
protected:
  void computeFields(UErrorCode &status) override {
    icu::GregorianCalendar::computeFields(status);
    if (U_FAILURE(status)) return;
    internalSet(UCAL_ERA, 0);
    internalSet(UCAL_YEAR, year);
    internalSet(UCAL_EXTENDED_YEAR, related_year);
    internalSet(UCAL_MONTH, month);
    internalSet(UCAL_IS_LEAP_MONTH, leap ? 1 : 0);
    internalSet(UCAL_DATE, day);
    internalSet(UCAL_DAY_OF_YEAR, day_of_year);
  }
public:
  int32_t related_year = 0, year = 0, month = 0, day = 0, day_of_year = 0;
  bool leap = false;
  CalendarFields(const icu::TimeZone &zone, const icu::Locale &locale, const char *name, UErrorCode &status)
      : icu::GregorianCalendar(zone, locale, status), type(name) {
    setGregorianChange(-9007199254740992.0, status);
  }
  CalendarFields *clone() const override { return new CalendarFields(*this); }
  const char *getType() const override { return type.c_str(); }
};
struct DateFormatter {
  icu::SimpleDateFormat formatter;
  icu::Locale locale;
  icu::UnicodeString text;
  icu::FieldPositionIterator positions;
  icu::UnicodeString scratch;
  std::vector<DateSpan> spans;
  std::vector<DateFieldLocator> locators;
  bool collapsed = true;
  std::unique_ptr<icu::DateIntervalFormat> range;
  std::unique_ptr<icu::Calendar> from, to;
  icu::ConstrainedFieldPosition range_position;
  CalendarFields *prepared = nullptr; // Borrowed from formatter's owned calendar.
  icu::Calendar *calendar = nullptr; // Borrowed from formatter's owned calendar.
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
    case UDAT_YEAR_NAME_FIELD: return 12; // Public and stable since ICU 49.
    case UDAT_DAY_OF_YEAR_FIELD: case UDAT_DAY_OF_WEEK_IN_MONTH_FIELD:
    case UDAT_WEEK_OF_YEAR_FIELD: case UDAT_WEEK_OF_MONTH_FIELD:
    case UDAT_YEAR_WOY_FIELD: case UDAT_JULIAN_DAY_FIELD:
    case UDAT_MILLISECONDS_IN_DAY_FIELD: case UDAT_QUARTER_FIELD:
    case UDAT_STANDALONE_QUARTER_FIELD: return 13;
    // Unrecognized vendor attributes are not public calendar fields. In
    // particular, time separators remain literal without naming private enums.
    default: return -1;
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
  state->calendar = calendar.get();
  state->formatter.adoptCalendar(calendar.release());
  return nts_boxed_new(state.release(), close_date, 0);
}

extern "C" bool nts_icu_date_field_locator(NtsHeader *handle, NtsString *marker, NtsString *pattern, double marker_code) {
  if (marker->length > INT32_MAX || pattern->length == 0 || pattern->length > INT32_MAX ||
      (marker_code != 0 && marker_code != 1)) return false;
  icu::UnicodeString marker_pattern, field_pattern;
  for (uint32_t index = 0; index < marker->length; index++) marker_pattern.append(static_cast<char16_t>(nts_unit(marker, index)));
  for (uint32_t index = 0; index < pattern->length; index++) field_pattern.append(static_cast<char16_t>(nts_unit(pattern, index)));
  date_state(handle)->locators.emplace_back(std::move(marker_pattern), std::move(field_pattern),
      marker_code == 0 ? UDAT_MILLISECONDS_IN_DAY_FIELD : UDAT_JULIAN_DAY_FIELD);
  return true;
}

static bool locate_fields(DateFormatter *state, UErrorCode &status) {
  for (auto &locator : state->locators) {
    if (!locator.field_formatter) {
      // Clone the configured formatter so its owned calendar has the same
      // presentation type. ICU otherwise substitutes its original chronology
      // when formatting fields from a different concrete Calendar class.
      locator.field_formatter.reset(state->formatter.clone());
      if (!locator.field_formatter) { status = U_MEMORY_ALLOCATION_ERROR; return false; }
      locator.field_formatter->applyPattern(locator.field_pattern);
      if (!locator.marker_pattern.isEmpty()) {
        locator.marker_formatter.reset(state->formatter.clone());
        if (!locator.marker_formatter) { status = U_MEMORY_ALLOCATION_ERROR; return false; }
        locator.marker_formatter->applyPattern(locator.marker_pattern);
      }
    }
    int32_t start = 0;
    if (locator.marker_formatter) {
      state->scratch.remove();
      locator.marker_formatter->format(*state->calendar, state->scratch, &state->positions, status);
      icu::FieldPosition position;
      bool found = false;
      while (state->positions.next(position)) {
        if (position.getField() == locator.marker) {
          start = position.getBeginIndex();
          found = true;
          break;
        }
      }
      if (U_FAILURE(status) || !found) return false;
    }
    state->scratch.remove();
    locator.field_formatter->format(*state->calendar, state->scratch, static_cast<icu::FieldPositionIterator *>(nullptr), status);
    const int32_t end = start + state->scratch.length();
    if (U_FAILURE(status) || end > state->text.length() || end <= start) return false;
    auto position = state->spans.begin();
    while (position != state->spans.end() && position->start <= start) ++position;
    state->spans.insert(position, {11, start, end});
  }
  return true;
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
  state->collapsed = true;
  UErrorCode status = U_ZERO_ERROR;
  state->calendar->setTime(milliseconds, status);
  state->formatter.format(*state->calendar, state->text, fields ? &state->positions : nullptr, status);
  if (U_FAILURE(status)) return nullptr;
  if (fields) {
    icu::FieldPosition position;
    while (state->positions.next(position)) {
      const int32_t field = field_code(position.getField());
      if (field >= 0) state->spans.push_back({field, position.getBeginIndex(), position.getEndIndex()});
    }
    if (!locate_fields(state, status)) return nullptr;
  }
  return date_text(state);
}
extern "C" double nts_icu_date_offset(NtsHeader *handle, double milliseconds) {
  if (!isfinite(milliseconds)) return NAN;
  DateFormatter *state = date_state(handle);
  UErrorCode status = U_ZERO_ERROR;
  int32_t raw, daylight;
  state->formatter.getTimeZone().getOffset(milliseconds, false, raw, daylight, status);
  return U_SUCCESS(status) ? static_cast<double>(raw) + daylight : NAN;
}
extern "C" bool nts_icu_date_calendar_fields(NtsHeader *handle, double related_year, double year, double month,
    bool leap, double day, double day_of_year) {
  if (!isfinite(related_year) || related_year != floor(related_year) || related_year < INT32_MIN || related_year > INT32_MAX ||
      year < 1 || year > 60 || year != floor(year) || month < 0 || month > 11 || month != floor(month) ||
      day < 1 || day > 30 || day != floor(day) || day_of_year < 1 || day_of_year > 400 || day_of_year != floor(day_of_year)) return false;
  DateFormatter *state = date_state(handle);
  if (state->prepared == nullptr) {
    const char *type = state->formatter.getCalendar()->getType();
    if (std::strcmp(type, "chinese") != 0 && std::strcmp(type, "dangi") != 0) return false;
    UErrorCode status = U_ZERO_ERROR;
    auto prepared = std::make_unique<CalendarFields>(state->formatter.getTimeZone(), state->locale, type, status);
    if (U_FAILURE(status)) return false;
    state->prepared = prepared.get();
    state->calendar = prepared.get();
    state->formatter.adoptCalendar(prepared.release());
    // Locators opened before preparation still own the original chronology.
    for (auto &locator : state->locators) {
      locator.field_formatter.reset();
      locator.marker_formatter.reset();
    }
  }
  state->prepared->related_year = static_cast<int32_t>(related_year);
  state->prepared->year = static_cast<int32_t>(year);
  state->prepared->month = static_cast<int32_t>(month);
  state->prepared->leap = leap;
  state->prepared->day = static_cast<int32_t>(day);
  state->prepared->day_of_year = static_cast<int32_t>(day_of_year);
  state->prepared->clear(); // Also invalidate when the next timestamp is equal.
  return true;
}
extern "C" NtsString *nts_icu_date_range(NtsHeader *handle, double start, double end, bool fields) {
  if (!isfinite(start) || !isfinite(end)) return nullptr;
  DateFormatter *state = date_state(handle);
  if (state->prepared != nullptr || !state->locators.empty()) return nullptr;
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
  state->collapsed = false;
  state->text = result.toString(status);
  return U_SUCCESS(status) ? date_text(state) : nullptr;
}
extern "C" double nts_icu_date_field_count(NtsHeader *handle) { return date_state(handle)->spans.size(); }
extern "C" bool nts_icu_date_range_collapsed(NtsHeader *handle) { return date_state(handle)->collapsed; }
extern "C" double nts_icu_date_field(NtsHeader *handle, double index, double component) {
  DateFormatter *state = date_state(handle);
  if (!isfinite(index) || index < 0 || index >= state->spans.size() || index != floor(index)) return NAN;
  const DateSpan &span = state->spans[static_cast<size_t>(index)];
  if (component == 0) return span.field;
  if (component == 1) return span.start;
  if (component == 2) return span.end;
  return NAN;
}
