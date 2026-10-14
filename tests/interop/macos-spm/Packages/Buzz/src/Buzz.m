#import "Buzz.h"

@implementation Buzz
+ (NSString *)buzzTimes:(NSInteger)times {
  NSMutableString *out = [NSMutableString string];
  for (NSInteger i = 0; i < times; i++) {
    [out appendString:@"bz"];
  }
  return out;
}
@end
