#include "loop.h"

#include <CoreFoundation/CoreFoundation.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

#include "nts_cf_host.h"

void nts_checkpoint_after_callbacks(bool on);

void loop_log(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}

void loop_run(void) { CFRunLoopRun(); }

// CPU spent so far, in milliseconds: the linger arm's measurement.
static long loop_cpu_ms(void) {
  struct rusage usage;
  getrusage(RUSAGE_SELF, &usage);
  return (long)(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000 +
         (long)(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1000;
}

static long loop_cpu_at_linger;

static void loop_stop_now(CFRunLoopTimerRef timer, void *info) {
  (void)timer;
  (void)info;
  if (getenv("LOOP_LINGER")) {
    char line[64];
    snprintf(line, sizeof line, "linger-cpu-ms %ld",
             loop_cpu_ms() - loop_cpu_at_linger);
    loop_log(line);
  }
  CFRunLoopStop(CFRunLoopGetMain());
}

static void loop_after(double seconds, CFRunLoopTimerCallBack callback,
                       void *info) {
  CFRunLoopTimerContext context = {0, info, NULL, NULL, NULL};
  CFRunLoopTimerRef timer = CFRunLoopTimerCreate(
      NULL, CFAbsoluteTimeGetCurrent() + seconds, 0, 0, 0, callback, &context);
  CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopCommonModes);
  CFRelease(timer);
}

void loop_stop(void) {
  const char *linger = getenv("LOOP_LINGER");
  if (linger == NULL || *linger == '\0') {
    CFRunLoopStop(CFRunLoopGetMain());
    return;
  }
  loop_cpu_at_linger = loop_cpu_ms();
  loop_after(atoi(linger) / 1000.0, loop_stop_now, NULL);
}

static void loop_event_fired(CFRunLoopTimerRef timer, void *info) {
  (void)timer;
  ((void (*)(void))info)();
}

void loop_event_later(void (*event)(void)) {
  loop_after(0.001, loop_event_fired, (void *)event);
}

void loop_event_now(void (*event)(void)) { event(); }

static void loop_give_up(CFRunLoopTimerRef timer, void *info) {
  (void)timer;
  (void)info;
  loop_log("gave-up");
  CFRunLoopStop(CFRunLoopGetMain());
}

void loop_control(void) {
  const char *control = getenv("LOOP_CONTROL");
  if (control == NULL || *control == '\0')
    return;
  if (strcmp(control, "nodrain") == 0)
    nts_checkpoint_after_callbacks(false);
  if (strcmp(control, "detached") == 0)
    nts_cf_host_detach();
  loop_after(3.0, loop_give_up, NULL);
}
