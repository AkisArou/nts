#include "live.h"

/* The runtime's, which a program may not bind by its own name. */
size_t nts_live_count(void);

size_t cairo_fixture_live(void) { return nts_live_count(); }
