#include <stdio.h>
#include <string.h>
#include "nts_node.h"
NtsString *normalize(NtsString *);
NtsString *dirname(NtsString *);
NtsString *basename(NtsString *);
NtsString *extname(NtsString *);
bool isAbsolute(NtsString *);
static NtsString *S(const char *s) { return nts_string_from_utf8(s, strlen(s)); }
static void show(const char *label, const NtsString *s) {
    printf("  %-28s ", label);
    for (uint32_t i = 0; i < s->length; i++) putchar((char)nts_unit(s, i));
    putchar('\n');
}
int main(void) {
    const char *messy = "/usr/local//lib/../include/./node/v8.h";
    printf("input   %s\n", messy);
    show("normalize", normalize(S(messy)));
    show("dirname", dirname(S(messy)));
    show("basename", basename(S(messy)));
    show("extname", extname(S(messy)));
    printf("  %-28s %s\n", "isAbsolute", isAbsolute(S(messy)) ? "true" : "false");
    show("process.cwd() via uv_cwd", nts_process_cwd());
    return 0;
}
