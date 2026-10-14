#include "support.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

#include <CoreFoundation/CoreFoundation.h>
#include <uv.h>

#include "nts_cf_host.h"

/* `CGRect`'s layout, four doubles, without CoreGraphics or <objc/runtime.h>:
 * the second's `imp_implementationWithBlock` is declared above with the block
 * as `void *`, and the two would conflict. */
typedef struct NtsRect {
  double x, y, width, height;
} NtsRect;
typedef struct NtsSize {
  double width, height;
} NtsSize;
struct objc_selector *sel_registerName(const char *name);
void objc_msgSend(void);
void objc_msgSend_stret(void);

double view_intrinsic_size(struct NSView *view) {
  NtsSize size = ((NtsSize(*)(struct NSView *, struct objc_selector *))objc_msgSend)(view, sel_registerName("intrinsicContentSize"));
  return size.width * 1000 + size.height;
}

/* `[view alignmentRectForFrame:{1, 2, 30, 40}]`, its x and width as one
 * number: 32 bytes back, in memory on x86_64. */
double view_alignment_rect(struct NSView *view) {
  NtsRect frame = {1, 2, 30, 40};
#if defined(__x86_64__)
  NtsRect rect = ((NtsRect(*)(struct NSView *, struct objc_selector *, NtsRect))objc_msgSend_stret)(view, sel_registerName("alignmentRectForFrame:"), frame);
#else
  NtsRect rect = ((NtsRect(*)(struct NSView *, struct objc_selector *, NtsRect))objc_msgSend)(view, sel_registerName("alignmentRectForFrame:"), frame);
#endif
  return rect.x * 1000 + rect.width;
}

bool view_is_flipped(struct NSView *view) {
  return ((signed char (*)(struct NSView *, struct objc_selector *))objc_msgSend)(view, sel_registerName("isFlipped")) != 0;
}

void send_draw_rect(struct NSView *view, double x, double y, double width, double height) {
  NtsRect rect = {x, y, width, height};
  ((void (*)(struct NSView *, struct objc_selector *, NtsRect))objc_msgSend)(view, sel_registerName("drawRect:"), rect);
}

void send_mouse_down(struct NSView *view, struct NSEvent *event) {
  ((void (*)(struct NSView *, struct objc_selector *, struct NSEvent *))objc_msgSend)(view, sel_registerName("mouseDown:"), event);
}

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void window_control(void) {
  const char *control = getenv("WINDOW_CONTROL");
  if (control != NULL && strcmp(control, "detached") == 0)
    nts_cf_host_detach();
}

static uv_async_t nested_wakeup;

static void nested_woken(uv_async_t *handle) { uv_close((uv_handle_t *)handle, NULL); }

static double cpu_ms(void) {
  struct rusage usage;
  getrusage(RUSAGE_SELF, &usage);
  return (double)(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000.0 +
         (double)(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1000.0;
}

void nested_while_readable(void) {
  const char *nested = getenv("WINDOW_NESTED");
  if (nested == NULL || strcmp(nested, "1") != 0)
    return;
  // A pending async makes libuv's kqueue readable until libuv next runs,
  // which it may not while this callback is on the stack.
  uv_async_init(uv_default_loop(), &nested_wakeup, nested_woken);
  uv_async_send(&nested_wakeup);
  double before = cpu_ms();
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 1.0, false);
  char line[64];
  snprintf(line, sizeof line, "nested-cpu-ms %d", (int)(cpu_ms() - before));
  report(line);
}
