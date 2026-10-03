#ifndef NTS_ICU_H
#define NTS_ICU_H
#include "nts_runtime.h"

bool nts_icu_versions_match(void);
NtsHeader *nts_icu_timezone_open(NtsString *id);
NtsString *nts_icu_timezone_id(NtsHeader *handle);
double nts_icu_timezone_offset(NtsHeader *handle, double epoch_ms);
double nts_icu_timezone_local_offset(NtsHeader *handle, double local_ms, bool former);
double nts_icu_timezone_transition(NtsHeader *handle, double epoch_ms, bool forward);
NtsHeader *nts_icu_number_open(NtsString *locale, NtsString *skeleton);
double nts_icu_currency_digits(NtsString *currency);
NtsString *nts_icu_number_format(NtsHeader *handle, double value, bool fields);
NtsString *nts_icu_number_decimal(NtsHeader *handle, NtsString *value, bool fields);
double nts_icu_number_field_count(NtsHeader *handle);
double nts_icu_number_field(NtsHeader *handle, double index, double component);

#endif
