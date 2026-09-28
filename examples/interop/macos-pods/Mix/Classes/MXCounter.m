#import "MXCounter.h"
// The pod's Swift half, as Objective-C in the same module reaches it.
#import "Mix-Swift.h"

@implementation MXCounter {
  NSInteger _count;
}

- (NSInteger)next {
  _count += 1;
  return _count;
}

- (NSString *)summary {
  return [MXWording counted:_count];
}
@end
