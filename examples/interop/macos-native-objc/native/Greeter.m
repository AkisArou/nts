#import "Greeter.h"

static NSInteger greetings;

@implementation Greeter
- (instancetype)initWithName:(NSString *)name {
  if ((self = [super init])) {
    _name = [name copy];
  }
  return self;
}

- (NSString *)greetWithTimes:(NSInteger)times {
  greetings += 1;
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSInteger i = 0; i < times; i++) {
    [parts addObject:[NSString stringWithFormat:@"hello %@", self.name]];
  }
  NSString *greeting = [parts componentsJoinedByString:@", "];
  id<GreeterDelegate> delegate = self.delegate;
  [delegate greeter:self didGreet:self.name];
  if ([delegate respondsToSelector:@selector(greeterShouldShout:)] && [delegate greeterShouldShout:self]) {
    return greeting.uppercaseString;
  }
  return greeting;
}

- (void)greetLaterWithCompletion:(void (^)(NSInteger))completion {
  [self greetWithTimes:1];
  NSInteger count = greetings;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
    completion(count);
  });
}

+ (NSInteger)greetingCount {
  return greetings;
}
@end

static __weak id watches[16];
static NSInteger watched;

NSInteger GreeterWatch(id object) {
  if (watched == 16) abort();
  watches[watched] = object;
  return watched++;
}

BOOL GreeterAlive(NSInteger watch) {
  return watches[watch] != nil;
}
