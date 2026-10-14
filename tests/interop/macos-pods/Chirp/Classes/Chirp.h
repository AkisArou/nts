// The pod's public header: what `objc:Chirp` is bound from.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface Chirp : NSObject
@property (nonatomic, readonly, copy) NSString *bird;
- (instancetype)initWithBird:(NSString *)bird;
- (NSString *)songWithNotes:(NSInteger)notes;
+ (NSString *)version;
@end

NS_ASSUME_NONNULL_END
