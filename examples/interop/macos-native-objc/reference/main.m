// The oracle: `src/main.ts` in Objective-C under ARC, printing the same lines.
#import "Greeter.h"
#include <stdio.h>

@interface Watcher : NSObject <GreeterDelegate>
@property (nonatomic) BOOL shout;
@end

@implementation Watcher
- (void)greeter:(Greeter *)greeter didGreet:(NSString *)name {
  printf("delegate greeted %s\n", name.UTF8String);
}
- (BOOL)greeterShouldShout:(Greeter *)greeter {
  return self.shout;
}
@end

static NSInteger greetings(Watcher *watcher) {
  Greeter *greeter = [[Greeter alloc] initWithName:@"nts"];
  NSInteger watch = GreeterWatch(greeter);
  printf("greet %s\n", [greeter greetWithTimes:2].UTF8String);
  printf("name %s\n", greeter.name.UTF8String);
  greeter.name = @"world";
  printf("renamed %s\n", [greeter greetWithTimes:1].UTF8String);
  printf("count %ld\n", (long)Greeter.greetingCount);
  greeter.delegate = watcher;
  printf("quiet %s\n", [greeter greetWithTimes:1].UTF8String);
  watcher.shout = YES;
  printf("shouted %s\n", [greeter greetWithTimes:1].UTF8String);
  watcher.shout = NO;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block NSInteger later;
  [greeter greetLaterWithCompletion:^(NSInteger count) {
    later = count;
    dispatch_semaphore_signal(done);
  }];
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  printf("later %ld\n", (long)later);
  return watch;
}

int main(void) {
  Watcher *watcher = [[Watcher alloc] init];
  NSInteger watch;
  @autoreleasepool {
    watch = greetings(watcher);
  }
  printf("greeter %s\n", GreeterAlive(watch) ? "alive" : "gone");
  return 0;
}
