#ifndef LATER_H
#define LATER_H

#include "nts_runtime.h"

NtsPromise *doubled(double x);
NtsPromise *ready(void);
void settle(void);

#endif
