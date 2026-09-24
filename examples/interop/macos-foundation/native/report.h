// The fixture's output, and the two autorelease-pool entry points libobjc
// exports without a public declaration (clang's ARC calls them).
#ifndef NTS_MACOS_FOUNDATION_REPORT_H
#define NTS_MACOS_FOUNDATION_REPORT_H

struct nts_pool;

// Prints `line` and a newline to stdout.
void report(const char *line);
struct nts_pool *objc_autoreleasePoolPush(void);
void objc_autoreleasePoolPop(struct nts_pool *pool);

#endif
