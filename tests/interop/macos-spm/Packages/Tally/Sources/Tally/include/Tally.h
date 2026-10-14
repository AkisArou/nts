#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface Tally : NSObject
@property (nonatomic, readonly) NSInteger count;
- (void)add:(NSInteger)amount;
- (NSString *)summary;
@end

NS_ASSUME_NONNULL_END
