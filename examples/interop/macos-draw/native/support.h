// Output, and zeroing weak references to Core Foundation objects, which are
// Objective-C objects on Apple's platforms.
#ifndef NTS_MACOS_DRAW_SUPPORT_H
#define NTS_MACOS_DRAW_SUPPORT_H

#include <stdbool.h>

struct CGColor;

void report(const char *line);
int weak_watch(struct CGColor *object);
bool weak_alive(int watch);

#endif
