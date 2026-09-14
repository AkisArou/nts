#include "nts_runtime.h"
NtsString *bridge_text(NtsString *);
NtsArray *bridge_array(NtsArray *);
double bridge_callback(NtsHeader *, double);
double bridge_nested(NtsValue, double);
NtsValue bridge_value(NtsValue);
void bridge_object(NtsHeader *);
void bridge_hidden(NtsValue);
__int128 bridge_bigint(__int128);
