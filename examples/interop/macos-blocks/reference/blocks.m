// The oracle for macos-blocks: the same program in Objective-C, compiled with
// ARC, so clang decides every block copy and every release. Both programs use
// Apple's Foundation and CoreFoundation on the same Mac; what is compared is
// whether the compiled TypeScript's blocks behave, and release, as clang's.
#import <CoreFoundation/CoreFoundation.h>
#import <Foundation/Foundation.h>
#include <stdio.h>

static void report(NSString *line) {
  printf("%s\n", line.UTF8String);
  fflush(stdout);
}

static NSString *state(__weak id *watch) { return *watch ? @"alive" : @"gone"; }

static __weak id cancelledWatch;
static __weak id tickingWatch;

static void enumerate(void) {
  NSMutableArray *array = [NSMutableArray arrayWithCapacity:3];
  [array addObject:[NSObject new]];
  [array addObject:[NSObject new]];
  [array addObject:[NSObject new]];
  __block int seen = 0;
  __block unsigned long indices = 0;
  [array enumerateObjectsUsingBlock:^(id object, NSUInteger index, BOOL *stop) {
    (void)object;
    (void)stop;
    seen++;
    indices += index;
  }];
  report([NSString stringWithFormat:@"enumerated %d %lu", seen, indices]);
  __block int visited = 0;
  [array enumerateObjectsUsingBlock:^(id object, NSUInteger index, BOOL *stop) {
    (void)object;
    visited++;
    if (index == 1) {
      *stop = YES;
    }
  }];
  report([NSString stringWithFormat:@"stopped after %d", visited]);
  // A block returning an object, called and let go of under ARC.
  __weak id madeWeak = nil;
  @autoreleasepool {
    id (^maker)(void) = ^id(void) {
      return [NSObject new];
    };
    id made = maker();
    madeWeak = made;
  }
  report([NSString stringWithFormat:@"returned %s", madeWeak ? "alive" : "gone"]);
  report(@"flags yes:7 no:-3");
}

static void cancelled(void) {
  NSObject *sentinel = [NSObject new];
  cancelledWatch = sentinel;
  NSTimer *timer = [NSTimer scheduledTimerWithTimeInterval:60 repeats:NO block:^(NSTimer *t) {
    (void)t;
    report([NSString stringWithFormat:@"never %lu", (unsigned long)sentinel.hash]);
  }];
  [timer invalidate];
}

static void finish(void) {
  report([NSString stringWithFormat:@"cancelled %@", state(&cancelledWatch)]);
  report([NSString stringWithFormat:@"ticking %@", state(&tickingWatch)]);
  CFRunLoopStop(CFRunLoopGetMain());
}

static void ticking(void) {
  NSObject *sentinel = [NSObject new];
  tickingWatch = sentinel;
  __block int ticks = 0;
  [NSTimer scheduledTimerWithTimeInterval:0.01 repeats:YES block:^(NSTimer *timer) {
    ticks++;
    report([NSString stringWithFormat:@"tick %d %@", ticks, sentinel.hash == 0 ? @"?" : @"held"]);
    if (ticks == 3) {
      [timer invalidate];
      // A later turn, as the TypeScript's `setTimeout(finish, 0)`.
      dispatch_async(dispatch_get_main_queue(), ^{ finish(); });
    }
  }];
}

int main(void) {
  @autoreleasepool {
    // A turn of its own, as the TypeScript's first `setTimeout`.
    dispatch_async(dispatch_get_main_queue(), ^{
      @autoreleasepool {
        enumerate();
        cancelled();
        ticking();
      }
    });
    CFRunLoopRun();
    report(@"done");
  }
  return 0;
}
