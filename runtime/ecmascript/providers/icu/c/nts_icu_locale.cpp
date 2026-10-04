extern "C" {
#include "nts_icu.h"
}
#include <unicode/locid.h>
#include <unicode/localematcher.h>
#include <unicode/listformatter.h>
#include <unicode/measfmt.h>
#include <unicode/numberformatter.h>
#include <unicode/numsys.h>
#include <unicode/uloc.h>
#include <unicode/ucal.h>
#include <unicode/ucol.h>
#include <unicode/udatpg.h>
#include <unicode/uenum.h>
#include <unicode/uscript.h>
#include <memory>
#include <string>

// ICU exposes CLDR alias replacement and its language-distance matcher through
// C++. This translation unit is a data primitive behind the existing C ABI;
// validation, Unicode-extension precedence and JS lists remain in TypeScript.
using icu::Locale;

static bool ascii(NtsString *input, std::string &output) {
  output.reserve(input->length);
  for (uint32_t index = 0; index < input->length; index++) {
    const uint16_t unit = nts_unit(input, index);
    if (unit == 0 || unit > 127) return false;
    output.push_back(static_cast<char>(unit));
  }
  return true;
}

static NtsString *string_result(const std::string &text) {
  NtsString *result = nts_str_raw(static_cast<uint32_t>(text.size()), 0);
  memcpy(NTS_ELEMENTS(result, uint8_t), text.data(), text.size());
  return result;
}

static NtsString *locale_result(const Locale &locale, UErrorCode &status) {
  const std::string tag = locale.toLanguageTag<std::string>(status);
  return U_SUCCESS(status) ? string_result(tag) : nullptr;
}

struct LocaleData {
  int32_t count;
  const Locale *available;
  icu::LocaleMatcher matcher;
  explicit LocaleData(UErrorCode &status)
      : count(0), available(Locale::getAvailableLocales(count)),
        matcher(icu::LocaleMatcher::Builder().setSupportedLocales(available, available + count)
                    .setNoDefaultLocale().build(status)) {}
};

static void close_locale(void *state, size_t data) {
  (void)data;
  delete static_cast<LocaleData *>(state);
}

static LocaleData *locale_state(NtsHeader *handle) {
  if (handle == nullptr || handle->descriptor == nullptr || handle->descriptor->kind != NTS_KIND_BOXED) abort();
  NtsBoxed *box = reinterpret_cast<NtsBoxed *>(handle);
  if (box->free != close_locale || box->boxed == nullptr) abort();
  return static_cast<LocaleData *>(box->boxed);
}

extern "C" NtsHeader *nts_icu_locale_open(void) {
  if (!nts_icu_versions_match()) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  auto data = std::make_unique<LocaleData>(status);
  if (U_FAILURE(status)) return nullptr;
  return nts_boxed_new(data.release(), close_locale, 0);
}

extern "C" NtsString *nts_icu_locale_transform(NtsString *tag, double operation) {
  if (!nts_icu_versions_match()) return nullptr;
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  Locale locale = Locale::forLanguageTag(text, status);
  locale.canonicalize(status);
  if (operation == 1) locale.addLikelySubtags(status);
  else if (operation == 2) locale.minimizeSubtags(status);
  else if (operation != 0) return nullptr;
  return locale_result(locale, status);
}

extern "C" NtsString *nts_icu_locale_default(void) {
  if (!nts_icu_versions_match()) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  Locale locale = Locale::getDefault();
  locale.canonicalize(status);
  return locale_result(locale, status);
}

extern "C" double nts_icu_locale_count(NtsHeader *handle) { return locale_state(handle)->count; }

extern "C" NtsString *nts_icu_locale_available(NtsHeader *handle, double index) {
  LocaleData *data = locale_state(handle);
  if (!isfinite(index) || index < 0 || index >= data->count || index != floor(index)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  Locale locale = data->available[static_cast<int32_t>(index)];
  locale.canonicalize(status);
  return locale_result(locale, status);
}

extern "C" NtsString *nts_icu_locale_best_fit(NtsHeader *handle, NtsString *tag) {
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const Locale desired = Locale::forLanguageTag(text, status);
  const Locale *match = locale_state(handle)->matcher.getBestMatch(desired, status);
  if (U_FAILURE(status) || match == nullptr) return nullptr;
  Locale locale = *match;
  locale.canonicalize(status);
  return locale_result(locale, status);
}

extern "C" NtsString *nts_icu_locale_numbering(NtsString *tag) {
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const Locale locale = Locale::forLanguageTag(text, status);
  std::unique_ptr<icu::NumberingSystem> system(icu::NumberingSystem::createInstance(locale, status));
  return U_SUCCESS(status) && system ? string_result(system->getName()) : nullptr;
}

extern "C" bool nts_icu_numbering_supported(NtsString *name) {
  std::string text;
  if (!ascii(name, text)) return false;
  UErrorCode status = U_ZERO_ERROR;
  std::unique_ptr<icu::NumberingSystem> system(icu::NumberingSystem::createInstanceByName(text.c_str(), status));
  return U_SUCCESS(status) && system && !system->isAlgorithmic() && system->getRadix() == 10;
}

extern "C" NtsString *nts_icu_locale_type(NtsString *key, NtsString *value) {
  std::string name, text;
  if (!ascii(key, name) || !ascii(value, text)) return nullptr;
  const char *canonical = uloc_toUnicodeLocaleType(name.c_str(), text.c_str());
  return string_result(canonical == nullptr ? text : canonical);
}

// The runtime array helpers inspect element shape, not descriptor identity.
// Strings cannot form cycles; the returned array owns each freshly made string.
static const NtsDescriptor strings = {
    NTS_KIND_ARRAY, sizeof(NtsString *), 1, 0, nullptr, nullptr, "ICU strings",
    0, nullptr, NTS_ARRAY_REFERENCE, 0, nullptr};

extern "C" NtsArray *nts_icu_locale_duration_samples(NtsString *tag) {
  if (!nts_icu_versions_match()) return nullptr;
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const Locale locale = Locale::forLanguageTag(text, status);
  icu::MeasureFormat formatter(locale, UMEASFMT_WIDTH_NUMERIC, status);
  const icu::Measure measures[] = {
      icu::Measure(icu::Formattable(7), icu::MeasureUnit::createHour(status), status),
      icu::Measure(icu::Formattable(8), icu::MeasureUnit::createMinute(status), status),
      icu::Measure(icu::Formattable(9), icu::MeasureUnit::createSecond(status), status)};
  icu::UnicodeString samples[7];
  icu::FieldPosition position(UNUM_INTEGER_FIELD);
  formatter.formatMeasures(measures, 3, samples[0], position, status);
  formatter.formatMeasures(measures, 2, samples[1], position, status);
  formatter.formatMeasures(measures + 1, 2, samples[2], position, status);
  const auto one = icu::number::NumberFormatter::forSkeleton(u"precision-integer group-off integer-width/*0", status).locale(locale);
  const auto two = icu::number::NumberFormatter::forSkeleton(u"precision-integer group-off integer-width/*00", status).locale(locale);
  samples[3] = one.formatInt(7, status).toString(status);
  for (int32_t index = 4; index < 7; index++) samples[index] = two.formatInt(index + 3, status).toString(status);
  if (U_FAILURE(status)) return nullptr;
  NtsArray *result = nts_array_new(&strings, 7);
  for (int32_t index = 0; index < 7; index++) {
    const icu::UnicodeString &sample = samples[index];
    if (sample.isBogus()) { nts_release(reinterpret_cast<NtsHeader *>(result)); return nullptr; }
    NtsString *value = nts_str_raw(static_cast<uint32_t>(sample.length()), 1);
    for (int32_t unit = 0; unit < sample.length(); unit++) NTS_ELEMENTS(value, uint16_t)[unit] = sample.charAt(unit);
    NTS_ITEMS(result, NtsString *)[index] = value;
  }
  return result;
}

extern "C" bool nts_icu_script_is_hebrew(double code_point) {
  if (!isfinite(code_point) || code_point < 0 || code_point > 0x10ffff || code_point != floor(code_point)) return false;
  UErrorCode status = U_ZERO_ERROR;
  const UScriptCode script = uscript_getScript(static_cast<UChar32>(code_point), &status);
  return U_SUCCESS(status) && script == USCRIPT_HEBREW;
}

extern "C" NtsArray *nts_icu_locale_list_samples(NtsString *tag, double type, double style, NtsArray *tokens) {
  if (!nts_icu_versions_match() || tokens->header.length != 4 || !isfinite(type) || !isfinite(style)
      || type < 0 || type > 2 || style < 0 || style > 2 || type != floor(type) || style != floor(style)) return nullptr;
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const Locale locale = Locale::forLanguageTag(text, status);
  std::unique_ptr<icu::ListFormatter> formatter(icu::ListFormatter::createInstance(locale,
      static_cast<UListFormatterType>(static_cast<int32_t>(type)),
      static_cast<UListFormatterWidth>(static_cast<int32_t>(style)), status));
  if (U_FAILURE(status) || !formatter) return nullptr;
  icu::UnicodeString items[4];
  for (int32_t index = 0; index < 4; index++) {
    const NtsString *token = NTS_ITEMS(tokens, NtsString *)[index];
    if (token == nullptr || token->length > INT32_MAX) return nullptr;
    for (uint32_t unit = 0; unit < token->length; unit++) items[index].append(static_cast<char16_t>(nts_unit(token, unit)));
  }
  NtsArray *result = nts_array_new(&strings, 3);
  for (int32_t index = 0; index < 3; index++) {
    icu::UnicodeString formatted;
    formatter->format(items, index + 2, formatted, status);
    if (U_FAILURE(status) || formatted.isBogus()) {
      nts_release(reinterpret_cast<NtsHeader *>(result));
      return nullptr;
    }
    NtsString *value = nts_str_raw(static_cast<uint32_t>(formatted.length()), 1);
    for (int32_t unit = 0; unit < formatted.length(); unit++) NTS_ELEMENTS(value, uint16_t)[unit] = formatted.charAt(unit);
    NTS_ITEMS(result, NtsString *)[index] = value;
  }
  return result;
}

extern "C" NtsArray *nts_icu_locale_values(NtsString *tag, double kind) {
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  UEnumeration *values = nullptr;
  const char *key = nullptr;
  if (kind == 3) {
    values = ucal_openTimeZones(&status);
  } else if (kind == 2) {
    values = ucal_openTimeZoneIDEnumeration(UCAL_ZONE_TYPE_CANONICAL_LOCATION, text.c_str(), nullptr, &status);
  } else {
    const Locale locale = Locale::forLanguageTag(text, status);
    if (kind == 0 || kind == 4) {
      key = "ca";
      values = ucal_getKeywordValuesForLocale("calendar", locale.getName(), kind == 0, &status);
    } else if (kind == 1) {
      key = "co";
      values = ucol_getKeywordValuesForLocale("collation", locale.getName(), false, &status);
    } else return nullptr;
  }
  std::unique_ptr<UEnumeration, decltype(&uenum_close)> owner(values, uenum_close);
  if (U_FAILURE(status) || values == nullptr) return nullptr;
  const int32_t count = uenum_count(values, &status);
  if (U_FAILURE(status)) return nullptr;
  NtsArray *result = nts_array_new(&strings, count);
  for (int32_t index = 0; index < count; index++) {
    const char *value = uenum_next(values, nullptr, &status);
    if (U_FAILURE(status) || value == nullptr) {
      nts_release(reinterpret_cast<NtsHeader *>(result));
      return nullptr;
    }
    const char *canonical = key == nullptr ? nullptr : uloc_toUnicodeLocaleType(key, value);
    NTS_ITEMS(result, NtsString *)[index] = string_result(canonical == nullptr ? value : canonical);
  }
  return result;
}

extern "C" NtsString *nts_icu_timezone_canonical(NtsString *name) {
  if (!nts_icu_versions_match() || name->length == 0 || name->length >= 256) return nullptr;
  UChar input[256], output[256];
  for (uint32_t index = 0; index < name->length; index++) input[index] = nts_unit(name, index);
  UErrorCode status = U_ZERO_ERROR;
  UBool system = false;
  const int32_t length = ucal_getCanonicalTimeZoneID(input, static_cast<int32_t>(name->length), output, 256, &system, &status);
  if (U_FAILURE(status) || !system) return nullptr;
  std::string result;
  result.reserve(length);
  for (int32_t index = 0; index < length; index++) result.push_back(static_cast<char>(output[index]));
  return string_result(result);
}

extern "C" NtsString *nts_icu_timezone_default(void) {
  if (!nts_icu_versions_match()) return nullptr;
  UChar output[256];
  UErrorCode status = U_ZERO_ERROR;
  const int32_t length = ucal_getDefaultTimeZone(output, 256, &status);
  if (U_FAILURE(status)) return nullptr;
  std::string result;
  result.reserve(length);
  for (int32_t index = 0; index < length; index++) {
    if (output[index] > 127) return nullptr;
    result.push_back(static_cast<char>(output[index]));
  }
  return string_result(result);
}

extern "C" NtsString *nts_icu_locale_hour_cycle(NtsString *tag) {
  std::string text;
  if (!ascii(tag, text)) return nullptr;
  UErrorCode status = U_ZERO_ERROR;
  const Locale locale = Locale::forLanguageTag(text, status);
  std::unique_ptr<UDateTimePatternGenerator, decltype(&udatpg_close)> generator(
      udatpg_open(locale.getName(), &status), udatpg_close);
  if (U_FAILURE(status)) return nullptr;
  const UDateFormatHourCycle cycle = udatpg_getDefaultHourCycle(generator.get(), &status);
  const char *names[] = {"h11", "h12", "h23", "h24"};
  return U_SUCCESS(status) && cycle >= UDAT_HOUR_CYCLE_11 && cycle <= UDAT_HOUR_CYCLE_24
      ? string_result(names[cycle]) : nullptr;
}

extern "C" double nts_icu_script_direction(NtsString *script) {
  std::string text;
  if (!ascii(script, text)) return -1;
  UErrorCode status = U_ZERO_ERROR;
  UScriptCode code;
  const int32_t count = uscript_getCode(text.c_str(), &code, 1, &status);
  if (U_FAILURE(status) || count != 1 || code == USCRIPT_UNKNOWN || code == USCRIPT_COMMON || code == USCRIPT_INHERITED) return -1;
  return uscript_isRightToLeft(code) ? 1 : 0;
}

extern "C" double nts_icu_locale_week(NtsString *region) {
  std::string text;
  if (!ascii(region, text)) return NAN;
  const std::string tag = "und-" + text;
  UErrorCode status = U_ZERO_ERROR;
  const Locale locale = Locale::forLanguageTag(tag, status);
  const UChar utc[] = { 'U', 'T', 'C' };
  std::unique_ptr<UCalendar, decltype(&ucal_close)> calendar(
      ucal_open(utc, 3, locale.getName(), UCAL_GREGORIAN, &status), ucal_close);
  if (U_FAILURE(status)) return NAN;
  int32_t data = ucal_getAttribute(calendar.get(), UCAL_FIRST_DAY_OF_WEEK);
  for (int32_t day = 1; day <= 7; day++) {
    const UCalendarWeekdayType type = ucal_getDayOfWeekType(calendar.get(), static_cast<UCalendarDaysOfWeek>(day), &status);
    // A day with any weekend interval participates in the locale's weekend.
    if (type != UCAL_WEEKDAY) data |= 1 << (day + 2);
  }
  return U_SUCCESS(status) ? data : NAN;
}
