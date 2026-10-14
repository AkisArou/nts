// The oracle for macos-subclass: the same program in Objective-C under ARC.
// The class is defined through the same runtime calls, with the method's
// implementation a block, so what is compared is the TypeScript program's
// use of them, and Foundation's answers.
#import <CoreFoundation/CoreFoundation.h>
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <stdio.h>

static void report(NSString *line) {
  printf("%s\n", line.UTF8String);
  fflush(stdout);
}

static int clicks = 0;
static __weak id targetWatch;

static void finish(void) {
  report([NSString stringWithFormat:@"target %@", targetWatch ? @"alive" : @"gone"]);
  CFRunLoopStop(CFRunLoopGetMain());
}

static void define(void) {
  Class cls = objc_allocateClassPair([NSObject class], "NtsClickTarget", 0);
  IMP clicked = imp_implementationWithBlock(^(id self, id sender) {
    clicks++;
    report([NSString stringWithFormat:@"clicked %d%@", clicks, self == sender ? @" by itself" : @" by another"]);
    if (clicks == 2) {
      dispatch_async(dispatch_get_main_queue(), ^{ finish(); });
    }
  });
  report([NSString stringWithFormat:@"added %@", class_addMethod(cls, sel_registerName("clicked:"), clicked, "v@:@") ? @"true" : @"false"]);
  objc_registerClassPair(cls);
}

static void start(void) {
  define();
  id target = [objc_getClass("NtsClickTarget") new];
  targetWatch = target;
  report([NSString stringWithFormat:@"responds %@", [target respondsToSelector:sel_registerName("clicked:")] ? @"true" : @"false"]);
  report([NSString stringWithFormat:@"is an NSObject %@", [target isKindOfClass:[NSObject class]] ? @"true" : @"false"]);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  [target performSelector:sel_registerName("clicked:") withObject:target];
#pragma clang diagnostic pop
  [NSTimer scheduledTimerWithTimeInterval:0.01 target:target selector:sel_registerName("clicked:") userInfo:nil repeats:NO];
}

int main(void) {
  @autoreleasepool {
    dispatch_async(dispatch_get_main_queue(), ^{
      @autoreleasepool {
        start();
      }
    });
    CFRunLoopRun();
    report(@"done");
  }
  return 0;
}
