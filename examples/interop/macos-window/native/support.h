// Output, the control switch, and the one runtime function whose prototype
// names a block, re-declared with the block as `void *` so the binding's view
// of it is the one checked.
#ifndef NTS_MACOS_WINDOW_SUPPORT_H
#define NTS_MACOS_WINDOW_SUPPORT_H

struct objc_imp;

void report(const char *line);
void window_control(void);
// libobjc's, declared by <objc/runtime.h> only with blocks enabled.
struct objc_imp *imp_implementationWithBlock(void *block);

#endif
