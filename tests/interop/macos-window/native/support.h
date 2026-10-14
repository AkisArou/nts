// Output, the control switch, and the one runtime function whose prototype
// names a block, re-declared with the block as `void *` so the binding's view
// of it is the one checked.
#ifndef NTS_MACOS_WINDOW_SUPPORT_H
#define NTS_MACOS_WINDOW_SUPPORT_H

#include <stdbool.h>

struct objc_imp;

void report(const char *line);
void window_control(void);
// Under `WINDOW_NESTED=1`: make libuv's backend descriptor readable, turn a
// nested run loop for a second from inside the current callback, and report
// the CPU that took. Nothing otherwise.
void nested_while_readable(void);
struct NSView;
// Sends `view` `drawRect:` with the rectangle (x, y, width, height), as AppKit
// does: a rectangle by value, which the override receives by the platform's
// convention -- in memory on x86_64.
void send_draw_rect(struct NSView *view, double x, double y, double width, double height);
// `intrinsicContentSize` as `width * 1000 + height`, and `alignmentRectForFrame:`
// of {1, 2, 30, 40} as `x * 1000 + width`, sent as AppKit sends them.
double view_intrinsic_size(struct NSView *view);
double view_alignment_rect(struct NSView *view);
// `[view mouseDown:event]`, as AppKit sends it.
struct NSEvent;
void send_mouse_down(struct NSView *view, struct NSEvent *event);
// Sends `view` `isFlipped`, as AppKit asks it.
bool view_is_flipped(struct NSView *view);
// libobjc's, declared by <objc/runtime.h> only with blocks enabled.
struct objc_imp *imp_implementationWithBlock(void *block);

#endif
