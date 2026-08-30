/* The table behind `Map` and `Set`.
 *
 * Every expected answer here was transcribed from node -- the program that
 * produced them is `oracle.mjs` in the comment beside each group -- rather
 * than from what this implementation happens to do. That is not ceremony: the
 * first version of `set` stored the key it was given, and node says
 * `m.set(-0, 1)` stores `+0`, because the spec normalizes at insertion and not
 * at comparison. Every lookup would still have found it, so nothing but the
 * oracle would have caught it.
 *
 * Reference counting, because half of this is about what the table retains and
 * gives back. Under NoGC nothing is released and those checks measure nothing.
 */
#include <stdio.h>
#include <math.h>
#include <string.h>

#include "nts_test_host.h"

static int failures;

static void check(const char *what, bool ok) {
    if (ok) {
        printf("ok   %s\n", what);
    } else {
        printf("FAIL %s\n", what);
        failures++;
    }
}

/* Strings this file makes, so it can give them back.
 *
 * A fresh string arrives with a count of one, and putting it in a map makes it
 * two -- the map's and the caller's. Compiled code releases the caller's when
 * the temporary dies; nothing here does, so they are collected and released
 * together before the closing measurement. Without this the suite leaked its
 * own strings and reported the table for it. */
static NtsString *temporaries[512];
static size_t temporary_count;

static NtsValue keep(NtsString *text) {
    temporaries[temporary_count++] = text;
    return nts_value_of_reference((NtsHeader *)text, NTS_TAG_STRING);
}

static void drop_temporaries(void) {
    while (temporary_count) {
        nts_release(temporaries[--temporary_count]);
    }
}

static NtsValue str(const char *text) {
    return keep(nts_string_from_utf8(text, (uint32_t)strlen(text)));
}

static NtsValue num(double d) { return nts_value_of_number(d); }

/* The insertion order of the live keys, as a comma-joined ASCII string, so it
 * can be compared against what `[...m.keys()].join(",")` printed. */
static void order_of(const NtsMap *map, char *out, size_t cap) {
    out[0] = 0;
    for (uint32_t at = 0; at < map->used; at++) {
        NtsValue key = map->keys[at];
        if (nts_value_tag(key) != NTS_TAG_STRING) {
            continue; /* a hole, or a key this helper does not print */
        }
        const NtsString *s = (const NtsString *)nts_value_reference(key);
        size_t len = strlen(out);
        if (len && len + 1 < cap) {
            out[len++] = ',';
            out[len] = 0;
        }
        for (uint32_t i = 0; i < s->length && len + 1 < cap; i++) {
            out[len++] = (char)NTS_ELEMENTS(s, unsigned char)[i];
            out[len] = 0;
        }
    }
}

int main(void) {
    size_t base = nts_live_bytes();

    /* --- order survives deletion and reinsertion -------------------------
     * node: for (const k of ["a".."e"]) m.set(k, ...); delete b, d;
     *       set("b"); set("f")  =>  a,c,e,b,f   size 5                    */
    {
        NtsMap *m = nts_map_new(NTS_KEY_STRING);
        const char *keys[] = {"a", "b", "c", "d", "e"};
        for (int i = 0; i < 5; i++) {
            nts_map_set(m, str(keys[i]), num(i));
        }
        check("size counts what was inserted", m->header.length == 5);
        nts_map_delete(m, str("b"));
        nts_map_delete(m, str("d"));
        check("size falls with deletion", m->header.length == 3);
        nts_map_set(m, str("b"), num(9));
        nts_map_set(m, str("f"), num(10));

        char order[64];
        order_of(m, order, sizeof order);
        check("reinsertion appends rather than restoring the old position",
              strcmp(order, "a,c,e,b,f") == 0);
        check("size after delete and reinsert", m->header.length == 5);
        check("a reinserted key reads back", nts_value_number(nts_map_get(m, str("b"))) == 9.0);
        check("a deleted key is gone", !nts_map_has(m, str("d")));
        nts_release(&m->header);
    }

    /* --- SameValueZero ----------------------------------------------------
     * node: s.set(NaN,"nan"); s.set(-0,"zero")
     *       s.get(NaN) => "nan";  s.get(0) === "zero" => true;  size 2
     *       z.set(-0,1); z.set(0,2);  Object.is(keys[0], -0) => false      */
    {
        NtsMap *m = nts_map_new(NTS_KEY_NUMBER);
        nts_map_set(m, num(0.0 / 0.0), num(1));
        nts_map_set(m, num(-0.0), num(2));
        check("NaN is a key and finds itself",
              nts_value_number(nts_map_get(m, num(0.0 / 0.0))) == 1.0);
        check("-0 and +0 are one key",
              nts_value_number(nts_map_get(m, num(0.0))) == 2.0);
        check("and count as one entry", m->header.length == 2);

        nts_map_set(m, num(0.0), num(3));
        check("setting through the other zero replaces the value",
              nts_value_number(nts_map_get(m, num(-0.0))) == 3.0);
        check("and does not add an entry", m->header.length == 2);
        /* The stored key is +0, not the -0 that created the entry. */
        bool positive = false;
        for (uint32_t at = 0; at < m->used; at++) {
            double d = nts_value_number(m->keys[at]);
            if (d == 0.0) {
                positive = !signbit(d);
            }
        }
        check("the stored zero key is +0, as node reports", positive);
        nts_release(&m->header);
    }

    /* --- strings are keys by value ----------------------------------------
     * node: t.set("ab", 1); t.get("a" + "b") => 1                          */
    {
        NtsMap *m = nts_map_new(NTS_KEY_STRING);
        nts_map_set(m, str("ab"), num(1));
        NtsValue joined = keep(nts_concat(
            (const NtsString *)nts_value_reference(str("a")),
            (const NtsString *)nts_value_reference(str("b"))));
        check("a concatenation finds the key it equals",
              nts_value_number(nts_map_get(m, joined)) == 1.0);
        check("a different string does not", !nts_map_has(m, str("ac")));
        nts_release(&m->header);
    }

    /* --- undefined is an ordinary key -------------------------------------
     * node: u.set(undefined, undefined) => has(undefined) true, size 1
     *       get is undefined for both absent and present-undefined         */
    {
        NtsMap *m = nts_map_new(NTS_KEY_ERASED);
        nts_map_set(m, nts_value_of_undefined(), nts_value_of_undefined());
        check("undefined is a key", nts_map_has(m, nts_value_of_undefined()));
        check("and counts", m->header.length == 1);
        check("get cannot tell it from absent, and neither can node's",
              nts_value_tag(nts_map_get(m, nts_value_of_undefined())) ==
                  NTS_TAG_UNDEFINED);
        check("an absent key is still absent", !nts_map_has(m, num(1)));
        /* A heterogeneous table: the number 3 and the string "3" are two keys. */
        nts_map_set(m, num(3), num(100));
        nts_map_set(m, str("3"), num(200));
        check("a number and its spelling are different keys",
              m->header.length == 3 &&
                  nts_value_number(nts_map_get(m, num(3))) == 100.0 &&
                  nts_value_number(nts_map_get(m, str("3"))) == 200.0);
        nts_release(&m->header);
    }

    /* --- Set ---------------------------------------------------------------
     * node: [3,1,3,2,1].forEach(add) => 3,1,2  size 3
     *       delete(3) => true; delete(3) again => false; size 2            */
    {
        NtsMap *s = nts_set_new(NTS_KEY_NUMBER);
        const double vs[] = {3, 1, 3, 2, 1};
        for (int i = 0; i < 5; i++) {
            nts_set_add(s, num(vs[i]));
        }
        check("adding a present value does not add an entry", s->header.length == 3);
        check("nor does it reorder", nts_value_number(s->keys[0]) == 3.0 &&
                                     nts_value_number(s->keys[1]) == 1.0 &&
                                     nts_value_number(s->keys[2]) == 2.0);
        check("a set stores no values at all", s->values == 0);
        check("delete reports whether it removed", nts_map_delete(s, num(3)));
        check("and reports false the second time", !nts_map_delete(s, num(3)));
        check("size after delete", s->header.length == 2);
        nts_release(&s->header);
    }

    /* --- growth ------------------------------------------------------------
     * Past every doubling, with the order checked after, because a rehash
     * that rebuilt the index from the entries in slot order rather than in
     * entry order would pass every lookup and lose the order.              */
    {
        NtsMap *m = nts_map_new(NTS_KEY_NUMBER);
        for (int i = 0; i < 1000; i++) {
            nts_map_set(m, num(i), num(i * 2));
        }
        check("1,000 insertions all present", m->header.length == 1000);
        bool ordered = true, found = true;
        for (int i = 0; i < 1000; i++) {
            if (nts_value_number(m->keys[i]) != (double)i) ordered = false;
            if (nts_value_number(nts_map_get(m, num(i))) != (double)(i * 2)) found = false;
        }
        check("every one reads back", found);
        check("insertion order survives every rehash", ordered);

        /* Deleting most of them and reinserting must not grow without bound:
         * the compaction on rehash is what reclaims the holes. */
        for (int i = 0; i < 900; i++) {
            nts_map_delete(m, num(i));
        }
        check("size after deleting 900", m->header.length == 100);
        for (int i = 0; i < 900; i++) {
            nts_map_set(m, num(i), num(i));
        }
        check("reinserting 900 restores the size", m->header.length == 1000);
        check("and the table did not grow unboundedly", m->capacity <= 4096u);
        nts_release(&m->header);
    }

    /* --- what it holds and gives back -------------------------------------- */
    {
        NtsString *shared = nts_string_from_utf8("shared", 6);
        uintptr_t before = shared->reserved;
        NtsMap *m = nts_map_new(NTS_KEY_STRING);
        nts_map_set(m, nts_value_of_reference((NtsHeader *)shared, NTS_TAG_STRING),
                    nts_value_of_reference((NtsHeader *)shared, NTS_TAG_STRING));
        check("a map retains its key and its value",
              shared->reserved == before + 2);
        nts_map_delete(m, nts_value_of_reference((NtsHeader *)shared, NTS_TAG_STRING));
        check("and releases both on delete", shared->reserved == before);
        nts_release(&m->header);
        nts_release(shared);
    }
    {
        NtsString *held = nts_string_from_utf8("held", 4);
        uintptr_t before = held->reserved;
        NtsMap *m = nts_map_new(NTS_KEY_STRING);
        nts_map_set(m, str("k"), nts_value_of_reference((NtsHeader *)held, NTS_TAG_STRING));
        check("a value is retained while the map lives", held->reserved == before + 1);
        nts_release(&m->header);
        check("and released when the map dies", held->reserved == before);
        nts_release(held);
    }

    /* Every allocation above is gone, including the three side arrays each
     * table owns -- which is the leak `storage.c` covers for arrays, asked of
     * the type that has three of them. */
    drop_temporaries();
    check("the whole suite returns to its baseline", nts_live_bytes() == base);

    printf("%s\n", failures ? "FAILURES" : "all map checks passed");
    return failures ? 1 : 0;
}
