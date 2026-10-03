/* Build-time adapter to the pinned QuickJS-ng Unicode database. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../c/quickjs/libunicode.c"

static void sequence(void *opaque, const uint32_t *points, int length) {
    printf("Q\t%s\t", (const char *)opaque);
    for (int i = 0; i < length; i++) printf("%s%u", i ? "," : "", points[i]);
    putchar('\n');
}

static void properties(const char *names, int kind) {
    for (const char *p = names; *p; p += strlen(p) + 1) {
        char first[128];
        size_t n = strcspn(p, ",");
        if (n >= sizeof(first)) abort();
        memcpy(first, p, n);
        first[n] = 0;
        CharRange range;
        cr_init(&range, NULL, NULL);
        int status;
        if (kind == 0) status = unicode_general_category(&range, first);
        else if (kind == 1 || kind == 2) status = unicode_script(&range, first, kind == 2);
        else if (kind == 3) status = unicode_prop(&range, first);
        else status = unicode_sequence_prop(first, sequence, first, &range);
        /* The database names some properties ECMAScript does not expose. */
        if (kind == 3 && status == -2) { cr_free(&range); continue; }
        if (status != 0) {
            fprintf(stderr, "property %d %s returned %d\n", kind, first, status);
            abort();
        }
        printf("P\t%d\t%s\t", kind, p);
        if (kind != 4) {
            for (int i = 0; i < range.len; i++) printf("%s%u", i ? "," : "", range.points[i]);
        }
        putchar('\n');
        cr_free(&range);
    }
}

int main(void) {
    properties(unicode_gc_name_table, 0);
    properties(unicode_script_name_table, 1);
    properties(unicode_script_name_table, 2);
    properties("Unknown,Zzzz\0", 1);
    properties("Unknown,Zzzz\0", 2);
    properties(unicode_prop_name_table, 3);
    properties(unicode_sequence_prop_name_table, 4);
    for (int mode = 0; mode < 2; mode++) {
        for (int point = 0; point < (mode ? 0x110000 : 0x10000); point++) {
            int folded = lre_canonicalize(point, mode != 0);
            if (folded != point) printf("F\t%d\t%d\t%d\n", mode, point, folded);
        }
    }
    return 0;
}
