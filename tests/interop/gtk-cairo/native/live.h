/* The runtime's count of live managed objects, which the fixture reads to
 * see that a boxed record a callback receives is given back each frame. */
#ifndef NTS_GTK_CAIRO_LIVE_H
#define NTS_GTK_CAIRO_LIVE_H

#include <stddef.h>

size_t cairo_fixture_live(void);

#endif
