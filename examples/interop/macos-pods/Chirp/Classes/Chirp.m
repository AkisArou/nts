#import "Chirp.h"
// A private header in a directory of its own, found through the header map
// CocoaPods makes of every header of the pod (Pods/Headers/Private/Chirp).
#import "Tweeter.h"

@implementation Chirp
- (instancetype)initWithBird:(NSString *)bird {
  if ((self = [super init])) {
    _bird = [bird copy];
  }
  return self;
}

- (NSString *)songWithNotes:(NSInteger)notes {
  return [NSString stringWithFormat:@"%@: %@", self.bird, [Tweeter noteRepeated:notes]];
}

+ (NSString *)version {
  return @"0.1.0";
}
@end
