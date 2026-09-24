// Output, the control switch, and the one runtime function whose prototype
// names a block, re-declared with the block as `void *` so the binding's view
// of it is the one checked.
#ifndef NTS_MACOS_WINDOW_SUPPORT_H
#define NTS_MACOS_WINDOW_SUPPORT_H

struct objc_imp;

void report(const char *line);
void window_control(void);
// Under `WINDOW_NESTED=1`: make libuv's backend descriptor readable, turn a
// nested run loop for a second from inside the current callback, and report
// the CPU that took. Nothing otherwise.
void nested_while_readable(void);
// libobjc's, declared by <objc/runtime.h> only with blocks enabled.
struct objc_imp *imp_implementationWithBlock(void *block);

#endif
