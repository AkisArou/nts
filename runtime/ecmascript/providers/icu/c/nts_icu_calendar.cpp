extern "C" {
#include "nts_icu.h"
}
// Keep this provider buildable with internal ICU declarations hidden.
#define U_HIDE_INTERNAL_API 1
#include <unicode/calendar.h>
#include <unicode/gregocal.h>
#include <unicode/locid.h>
#include <unicode/timezone.h>
#include <unicode/uloc.h>
#include <memory>
#include <string>

static constexpr double day_millis = 86400000.0;
static void close_data_calendar(void *state, size_t data) {
  (void)data;
  delete static_cast<icu::Calendar *>(state);
}
static icu::Calendar *data_calendar(NtsHeader *handle) {
  if (handle == nullptr || handle->descriptor == nullptr ||
      handle->descriptor->kind != NTS_KIND_BOXED) abort();
  auto box = reinterpret_cast<NtsBoxed *>(handle);
  if (box->free != close_data_calendar || box->boxed == nullptr) abort();
  return static_cast<icu::Calendar *>(box->boxed);
}
extern "C" NtsHeader *nts_icu_calendar_open(NtsString *identifier) {
  if (!nts_icu_versions_match() || identifier->length == 0 || identifier->length > 32)
    return nullptr;
  std::string id;
  id.reserve(identifier->length);
  for (uint32_t index = 0; index < identifier->length; index++) {
    const uint16_t unit = nts_unit(identifier, index);
    if (!((unit >= 'a' && unit <= 'z') || (unit >= '0' && unit <= '9') || unit == '-'))
      return nullptr;
    id.push_back(static_cast<char>(unit));
  }
  const char *type = uloc_toLegacyType("calendar", id.c_str());
  if (type == nullptr) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const auto locale = icu::Locale::forLanguageTag("und-u-ca-" + id, status);
  std::unique_ptr<icu::Calendar> calendar(icu::Calendar::createInstance(
      icu::TimeZone::getGMT()->clone(), locale, status));
  if (U_FAILURE(status) || !calendar || strcmp(calendar->getType(), type) != 0)
    return nullptr;
  if (auto gregorian = dynamic_cast<icu::GregorianCalendar *>(calendar.get()))
    gregorian->setGregorianChange(-9007199254740992.0, status);
  if (U_FAILURE(status)) return nullptr;
  calendar->setLenient(false);
  return nts_boxed_new(calendar.release(), close_data_calendar, 0);
}
extern "C" bool nts_icu_calendar_load(NtsHeader *handle, double epoch_day) {
  const double milliseconds = epoch_day * day_millis;
  if (!isfinite(epoch_day) || epoch_day != floor(epoch_day) ||
      fabs(milliseconds) > 9007199254740991.0) return false;
  auto calendar = data_calendar(handle);
  // Match the safe raw-data range of ICU4J, whose Hebrew cache can hang
  // before year 1. Shared Hebrew arithmetic supports those dates directly.
  if (strcmp(calendar->getType(), "hebrew") == 0 && epoch_day < -2092590) return false;
  UErrorCode status = U_ZERO_ERROR;
  calendar->setTime(milliseconds, status);
  const double actual = calendar->getTime(status);
  calendar->get(UCAL_EXTENDED_YEAR, status);
  calendar->get(UCAL_ORDINAL_MONTH, status);
  calendar->get(UCAL_DAY_OF_MONTH, status);
  return U_SUCCESS(status) && actual == milliseconds;
}
extern "C" double nts_icu_calendar_field(NtsHeader *handle, double index) {
  if (!isfinite(index) || index != floor(index) || index < 0 || index > 7) return NAN;
  auto calendar = data_calendar(handle);
  UErrorCode status = U_ZERO_ERROR;
  int32_t value;
  switch (static_cast<int32_t>(index)) {
    case 0: value = calendar->get(UCAL_EXTENDED_YEAR, status); break;
    case 1: value = calendar->get(UCAL_ORDINAL_MONTH, status); break;
    case 2: value = calendar->get(UCAL_DAY_OF_MONTH, status); break;
    case 3: value = calendar->get(UCAL_DAY_OF_YEAR, status); break;
    case 4: value = calendar->getActualMaximum(UCAL_DAY_OF_MONTH, status); break;
    case 5: value = calendar->getActualMaximum(UCAL_DAY_OF_YEAR, status); break;
    case 6: value = calendar->getActualMaximum(UCAL_ORDINAL_MONTH, status) + 1; break;
    default: value = calendar->inTemporalLeapYear(status) ? 1 : 0; break;
  }
  return U_SUCCESS(status) ? value : NAN;
}
extern "C" NtsString *nts_icu_calendar_month_code(NtsHeader *handle) {
  UErrorCode status = U_ZERO_ERROR;
  const char *code = data_calendar(handle)->getTemporalMonthCode(status);
  if (U_FAILURE(status) || code == nullptr) return nullptr;
  const auto length = static_cast<uint32_t>(strlen(code));
  NtsString *result = nts_str_raw(length, 0);
  memcpy(NTS_ELEMENTS(result, uint8_t), code, length);
  return result;
}
static bool integer(double value) {
  return isfinite(value) && value == floor(value) && value >= INT32_MIN && value <= INT32_MAX;
}
extern "C" double nts_icu_calendar_to_day(NtsHeader *handle, double year, double month, double day) {
  if (!integer(year) || !integer(month) || !integer(day)) return NAN;
  auto calendar = data_calendar(handle);
  calendar->clear();
  if (strcmp(calendar->getType(), "hebrew") == 0 && year <= 0) return NAN;
  calendar->set(UCAL_EXTENDED_YEAR, static_cast<int32_t>(year));
  calendar->set(UCAL_MONTH, 0);
  calendar->set(UCAL_DAY_OF_MONTH, 1);
  UErrorCode status = U_ZERO_ERROR;
  calendar->getTime(status);
  const int32_t last = calendar->getActualMaximum(UCAL_ORDINAL_MONTH, status);
  if (U_FAILURE(status) || month < 0 || month > last) return NAN;
  // Position within the year's public month topology. The pinned ordinal
  // setter wraps month 13 in late-leap Chinese years; it cannot supply this
  // conversion directly. JS date addition/overflow is still shared TS.
  if (month != 0) {
    calendar->add(UCAL_MONTH, static_cast<int32_t>(month), status);
    const double first = calendar->getTime(status);
    // Reset user field stamps so a subsequent day setter retains this month.
    calendar->setTime(first, status);
  }
  calendar->set(UCAL_DAY_OF_MONTH, static_cast<int32_t>(day));
  const double milliseconds = calendar->getTime(status);
  return U_SUCCESS(status) ? milliseconds / day_millis : NAN;
}
