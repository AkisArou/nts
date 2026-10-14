#ifndef CBLINK_H
#define CBLINK_H

// A dependency's public header, which SwiftPM puts on this target's search
// path -- and on the path of whatever imports this one.
#include "cblink_core.h"

/// Blinks in `times` steps.
int cblink_rate(int times);

#endif
