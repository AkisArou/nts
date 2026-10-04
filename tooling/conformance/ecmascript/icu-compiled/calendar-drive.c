#include "program.h"
#include "calendar-cases.h"
#include <stdio.h>
#include <stdlib.h>

static void text(NtsString *result, const char *expected) {
  if (result == NULL || result->length != strlen(expected)) abort();
  for (uint32_t index = 0; index < result->length; index++) {
    const uint16_t unit = nts_unit(result, index);
    if (unit != (unsigned char)expected[index]) abort();
    putchar(unit);
  }
  putchar('\n');
#ifdef NTS_PROVIDER_RC
  nts_release((NtsHeader *)result);
#endif
}
int main(void) {
  module__init();
  for (size_t index = 0; index < sizeof(calendar_cases) / sizeof(calendar_cases[0]); index++) {
    const CalendarCase *sample = &calendar_cases[index];
    NtsString *id = nts_string_from_required_cstring(sample->calendar);
    text(snapshot(id, sample->day), sample->expected);
#ifdef NTS_PROVIDER_RC
    nts_release((NtsHeader *)id);
#endif
  }
  for (size_t index = 0; index < sizeof(calendar_ids) / sizeof(calendar_ids[0]); index++) {
    NtsString *id = nts_string_from_required_cstring(calendar_ids[index]);
    const double ordinary = roundTrips(id, -25567, 55000, 1);
    const bool hebrew = strcmp(calendar_ids[index], "hebrew") == 0;
    const bool arithmetic = !hebrew && strcmp(calendar_ids[index], "chinese") != 0 &&
      strcmp(calendar_ids[index], "dangi") != 0 && strcmp(calendar_ids[index], "persian") != 0 &&
      strcmp(calendar_ids[index], "islamic-umalqura") != 0;
    if (hebrew && hebrewProviderAgreement(-25567, 55000) != 55000) abort();
    if (arithmetic && arithmeticProviderAgreement(id, -25567, 55000) != 55000) abort();
    const double extended = hebrew
      ? hebrewRoundTrips(-100000000, 1001, 200000)
      : arithmetic ? arithmeticRoundTrips(id, -100000000, 1001, 200000)
      : roundTrips(id, -100000000, 1001, 200000);
    if (!isfinite(ordinary) || ordinary < 55000 || ordinary > 55000 * 500 ||
        !isfinite(extended) || extended < -1001 || extended > 1001 * 500 || !invalidDate(id)) abort();
    printf("%s:roundtrips:55000:invalid:true:extended:%.0f\n", calendar_ids[index], extended < 0 ? extended : 0);
#ifdef NTS_PROVIDER_RC
    nts_release((NtsHeader *)id);
#endif
  }
  return 0;
}
