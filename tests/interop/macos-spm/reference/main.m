// The oracle: `src/main.ts` in Objective-C, compiled with the packages'
// sources: Tally's, and Blink's Swift, through the header Swift writes for it.
#import "Tally.h"
#import "Blink-Swift.h"
#import <Buzz/Buzz.h>
#include <stdio.h>

int main(void) {
  @autoreleasepool {
    Tally *tally = [[Tally alloc] init];
    [tally add:3];
    [tally add:4];
    printf("tally %ld %s\n", (long)tally.count, tally.summary.UTF8String);
    Blink *blink = [[Blink alloc] initWithTimes:3];
    printf("blink %s\n", blink.pattern.UTF8String);
    printf("blink rate %ld\n", (long)[blink rate]);
    printf("buzz %s\n", [Buzz buzzTimes:3].UTF8String);
  }
  return 0;
}
