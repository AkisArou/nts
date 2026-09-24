// Output, the main run loop, and zeroing weak references. And the one
// runtime function whose prototype names a block, re-declared here with the
// block as `void *` so the binding's view of it is the one checked.
#ifndef NTS_MACOS_SUBCLASS_SUPPORT_H
#define NTS_MACOS_SUBCLASS_SUPPORT_H

#include <stdbool.h>

struct NSObject;
struct objc_imp;

void report(const char *line);
void loop_run(void);
void loop_stop(void);
int weak_watch(struct NSObject *object);
bool weak_alive(int watch);
// libobjc's, declared by <objc/runtime.h> only with blocks enabled.
struct objc_imp *imp_implementationWithBlock(void *block);

#endif
