#include <stdio.h>
#include <string.h>
#include "nts_node.h"
NtsString *readFileSync(NtsString *);
void writeFileSync(NtsString *, NtsString *);
bool existsSync(NtsString *);
static NtsString *S(const char *s) { return nts_string_from_utf8(s, strlen(s)); }
static void put(const NtsString *s) { for (uint32_t i=0;i<s->length;i++) putchar((char)nts_unit(s,i)); }
int main(void) {
    NtsString *p = S("/tmp/nts-fsdemo/hello.txt");
    writeFileSync(p, S("written by nts\n"));
    printf("existsSync   %s\n", existsSync(p) ? "true" : "false");
    printf("readFileSync "); put(readFileSync(p));
    printf("existsSync(missing) %s\n", existsSync(S("/tmp/nts-fsdemo/nope.txt")) ? "true" : "false");
    return 0;
}
