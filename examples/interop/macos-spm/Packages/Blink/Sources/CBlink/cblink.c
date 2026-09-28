#include "cblink.h"

int cblink_rate(int times) { return times * cblink_core_step(); }
