// Output, and zeroing weak references.
#ifndef NTS_MACOS_CLASSES_SUPPORT_H
#define NTS_MACOS_CLASSES_SUPPORT_H

#include <stdbool.h>

struct NSObject;
struct NSString;

void report_string(const char *label, struct NSString *text);
int weak_watch(struct NSObject *object);
bool weak_alive(int watch);
double now_ns(void);

#endif
