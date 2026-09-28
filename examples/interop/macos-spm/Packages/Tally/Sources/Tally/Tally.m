#import "Tally.h"
#import <CoreFoundation/CoreFoundation.h>

@implementation Tally
- (void)add:(NSInteger)amount {
  _count += amount;
}

- (NSString *)summary {
  // Core Foundation, which the target's linker settings name.
  CFStringRef text = CFStringCreateWithFormat(NULL, NULL, CFSTR("%ld counted"), (long)self.count);
  return (__bridge_transfer NSString *)text;
}
@end
