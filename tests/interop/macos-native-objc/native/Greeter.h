// The project's own Objective-C, which the program imports as
// `objc:Greeter`: `nts build` reads this header, extracts Swift's names for
// it, and compiles `Greeter.m` beside the program.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class Greeter;

// A protocol a TypeScript class adopts: one required method, one optional.
@protocol GreeterDelegate <NSObject>
- (void)greeter:(Greeter *)greeter didGreet:(NSString *)name;
@optional
- (BOOL)greeterShouldShout:(Greeter *)greeter;
@end

@interface Greeter : NSObject
@property (nonatomic, copy) NSString *name;
@property (nonatomic, weak, nullable) id<GreeterDelegate> delegate;
- (instancetype)initWithName:(NSString *)name;
- (NSString *)greetWithTimes:(NSInteger)times;
// Completes on another thread, as a framework's completion handler may,
// with how many greetings there have been.
- (void)greetLaterWithCompletion:(void (^)(NSInteger count))completion;
// The same, with the greeting: a string a block is given.
- (void)greetingLaterWithCompletion:(void (^)(NSString *greeting))completion;
+ (NSInteger)greetingCount;
@end

// Zeroing weak references, by which an object's release is seen.
NSInteger GreeterWatch(id object);
BOOL GreeterAlive(NSInteger watch);

NS_ASSUME_NONNULL_END
