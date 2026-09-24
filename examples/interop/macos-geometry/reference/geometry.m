// The oracle: `src/main.ts` in Objective-C under ARC.
#import <Foundation/Foundation.h>
#include <stdio.h>

int main(void) {
  @autoreleasepool {
    NSRect a = NSMakeRect(0, 0, 10, 10);
    NSRect b = NSMakeRect(5, 2.5, 10, 10);
    NSRect i = NSIntersectionRect(a, b);
    printf("intersection %g %g %g %g\n", i.origin.x, i.origin.y, i.size.width, i.size.height);

    NSValue *boxed = [NSValue valueWithRect:b];
    NSRect back = [boxed rectValue];
    printf("rect %g %g %g %g\n", back.origin.x, back.origin.y, back.size.width, back.size.height);
    b.size.width = 99;
    printf("kept %g\n", back.size.width);

    NSPoint q = [[NSValue valueWithPoint:NSMakePoint(3.5, -1)] pointValue];
    printf("point %g %g\n", q.x, q.y);
  }
  return 0;
}
