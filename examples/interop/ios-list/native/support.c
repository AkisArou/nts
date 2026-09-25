#include "support.h"

#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>

// UIKit's, declared by its Objective-C header only.
int UIApplicationMain(int argc, char *argv[], CFStringRef principal, CFStringRef delegate);

void report(const char *line) {
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

void ios_main(const char *delegate) {
  CFStringRef name = CFStringCreateWithCString(NULL, delegate, kCFStringEncodingUTF8);
  UIApplicationMain(0, NULL, NULL, name);
}

void ios_exit(int code) { exit(code); }
