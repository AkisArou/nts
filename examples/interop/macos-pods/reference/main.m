// The oracle: `src/main.ts` in Objective-C, compiled with the pods' sources:
// Chirp's, and Hum's Swift, through the header Swift writes for it; and Beep,
// linked from its framework.
#import "Chirp.h"
#import "Hum-Swift.h"
#import <Beep/Beep.h>
#include <stdio.h>

int main(void) {
  @autoreleasepool {
    Chirp *chirp = [[Chirp alloc] initWithBird:@"wren"];
    printf("song %s\n", [chirp songWithNotes:3].UTF8String);
    printf("bird %s\n", chirp.bird.UTF8String);
    printf("version %s\n", Chirp.version.UTF8String);
    Hum *hum = [[Hum alloc] initWithTune:@"la"];
    printf("hum %s\n", [hum hummedWithTimes:3].UTF8String);
    printf("beep %s\n", [Beep beepTimes:2].UTF8String);
  }
  return 0;
}
