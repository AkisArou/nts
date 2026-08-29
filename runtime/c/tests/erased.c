/* An erased value crossing a promise.
 *
 * A promise stores its payload in a closed two-slot union -- a double or a
 * pointer -- because the compiler always knew which one it had put there. An
 * erased value is exactly the case where it does not, and the interesting
 * question is not "can it hold one" but "does the tag survive". Five tags map
 * onto two slots, so `boolean` and `number` share a slot and `string` and
 * `object` share the other; if the tag were not recorded separately, `typeof`
 * on the far side of an `await` would answer for the slot rather than for the
 * value, and it would be wrong quietly.
 *
 * The other half is reference counting. `nts_promise_fulfill_value` retains
 * through the same slot `nts_promise_fulfill_reference` uses, which is what
 * lets the collector keep walking a descriptor of fixed offsets: `reference`
 * holds a reference or null, exactly as it always did, and no pass has to
 * learn that a slot is conditional.
 *
 * Build this with `-DNTS_PROVIDER_RC`. Under the non-counting provider nothing
 * is ever released, so every count below is trivially equal and the half of
 * this file that is about retaining measures nothing at all.
 */
#include <stdio.h>
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

/* The refcount, which lives in `reserved` rather than in `flags` -- `flags`
 * holds the cycle collector's colour. Read rather than remembered: the two are
 * adjacent and guessing wrong would have made every count below trivially
 * true. */
static uintptr_t rc(const void *object) {
    return ((const NtsHeader *)object)->reserved;
}

/* `race` takes an array of promises, and the array owns a reference to each,
 * exactly as `combinators.c` builds one. */
static NtsArray *promise_array(NtsPromise **items, uint32_t count) {
    NtsArray *array = nts_array_new(&nts_desc_ref, count);
    for (uint32_t i = 0; i < count; i++) {
        nts_retain((NtsHeader *)items[i]);
        NTS_ITEMS(array, NtsHeader *)[i] = (NtsHeader *)items[i];
    }
    return array;
}

static NtsValue number(double n) {
    NtsValue v;
    v.tag = NTS_TAG_NUMBER;
    v.as.number = n;
    return v;
}

static NtsValue boolean(bool b) {
    NtsValue v;
    v.tag = NTS_TAG_BOOLEAN;
    v.as.boolean = b;
    return v;
}

static NtsValue undefined(void) {
    NtsValue v;
    v.tag = NTS_TAG_UNDEFINED;
    v.as.number = 0.0;
    return v;
}

static NtsValue reference(NtsHeader *r, uint32_t tag) {
    NtsValue v;
    v.tag = tag;
    v.as.reference = r;
    return v;
}

int main(void) {
    nts_test_host_install();

    /* Each tag survives the round trip. The two that share a slot with another
     * tag are the ones worth having: a boolean is stored as a double, so only
     * the recorded tag distinguishes it from the number 1. */
    {
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, number(42.5));
        NtsValue out = nts_promise_value(p);
        check("a number keeps its tag", out.tag == NTS_TAG_NUMBER);
        check("a number keeps its value", out.as.number == 42.5);
        nts_release((NtsHeader *)p);
    }

    {
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, boolean(true));
        NtsValue out = nts_promise_value(p);
        check("a boolean is not a number", out.tag == NTS_TAG_BOOLEAN);
        check("a boolean keeps its value", out.as.boolean == true);
        nts_release((NtsHeader *)p);
    }

    {
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, boolean(false));
        NtsValue out = nts_promise_value(p);
        check("false is a boolean, not absent", out.tag == NTS_TAG_BOOLEAN);
        check("false survives the double slot", out.as.boolean == false);
        nts_release((NtsHeader *)p);
    }

    {
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, undefined());
        NtsValue out = nts_promise_value(p);
        check("undefined keeps its tag", out.tag == NTS_TAG_UNDEFINED);
        nts_release((NtsHeader *)p);
    }

    /* A reference is retained on the way in and released with the promise,
     * through the slot the descriptor already knows about. */
    {
        NtsString *s = nts_string_from_utf8("hello", 5);
        uint32_t before = rc(s);

        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, reference((NtsHeader *)s, NTS_TAG_STRING));
        check("settling with a string retains it", rc(s) == before + 1);

        NtsValue out = nts_promise_value(p);
        check("a string keeps its tag", out.tag == NTS_TAG_STRING);
        check("a string keeps its identity", out.as.reference == (NtsHeader *)s);
        check("reading does not retain again", rc(s) == before + 1);

        nts_release((NtsHeader *)p);
        check("releasing the promise releases the string", rc(s) == before);
        nts_release((NtsHeader *)s);
    }

    /* An object tag reaches the same slot and must not arrive as a string:
     * both are pointers, and only the tag tells them apart. */
    {
        NtsString *s = nts_string_from_utf8("x", 1);
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, reference((NtsHeader *)s, NTS_TAG_OBJECT));
        NtsValue out = nts_promise_value(p);
        check("an object is not a string", out.tag == NTS_TAG_OBJECT);
        nts_release((NtsHeader *)p);
        nts_release((NtsHeader *)s);
    }

    /* A payload settled through a *typed* helper still answers `typeof`.
     *
     * `nts_promise_fulfill_reference` knows it holds a reference and not which
     * kind, so the tag is derived from the header rather than assumed. Assuming
     * `object` is invisible until someone races a string into an erased `await`
     * and asks what it is -- a wrong answer that no typed reader could ever
     * see, because a typed reader already knew.
     */
    {
        NtsString *s = nts_string_from_utf8("typed", 5);
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_reference(p, (NtsHeader *)s);
        check("a string settled as a reference reads back a string",
              nts_promise_value(p).tag == NTS_TAG_STRING);
        nts_release((NtsHeader *)p);
        nts_release((NtsHeader *)s);
    }

    {
        /* Any non-string managed object; a promise is the one this file can
         * build without a descriptor of its own. */
        NtsPromise *payload = nts_promise_new();
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_reference(p, (NtsHeader *)payload);
        check("a non-string settled as a reference reads back an object",
              nts_promise_value(p).tag == NTS_TAG_OBJECT);
        nts_release((NtsHeader *)p);
        nts_release((NtsHeader *)payload);
    }

    /* Settling twice is ignored, as it is for every other payload. */
    {
        NtsPromise *p = nts_promise_new();
        nts_promise_fulfill_value(p, number(1.0));
        nts_promise_fulfill_value(p, number(2.0));
        check("a promise settles once", nts_promise_value(p).as.number == 1.0);
        nts_release((NtsHeader *)p);
    }

    /* The forwarder, which is what `race` is. Without an arm for an erased
     * payload this reaches `default` and fulfils with `undefined` -- the
     * value is gone and nothing reports it. */
    {
        NtsPromise *source = nts_promise_new();
        nts_promise_fulfill_value(source, boolean(true));

        NtsArray *array = promise_array(&source, 1);
        NtsPromise *result = nts_promise_race(array);
        nts_test_host_run(64);

        NtsValue out = nts_promise_value(result);
        check("race forwards an erased payload", out.tag == NTS_TAG_BOOLEAN);
        check("race forwards its value", out.as.boolean == true);

        nts_release((NtsHeader *)result);
        nts_release((NtsHeader *)array);
        nts_release((NtsHeader *)source);
    }

    /* A forwarded reference is given back once the promises are released.
     *
     * With a cycle collection, because a combinator, its slots and its result
     * promise reference each other -- reference counting alone cannot reclaim
     * that, and `combinators.c` collects before it measures for the same
     * reason. Without it the count stays high and looks exactly like a leak,
     * which is what it looked like here for half an hour.
     */
    {
        NtsString *s = nts_string_from_utf8("shared", 6);
        uintptr_t before = rc(s);

        NtsPromise *source = nts_promise_new();
        nts_promise_fulfill_value(source, reference((NtsHeader *)s, NTS_TAG_STRING));
        NtsArray *array = promise_array(&source, 1);
        NtsPromise *result = nts_promise_race(array);
        nts_test_host_run(64);

        check("the forwarded-to promise holds it too", rc(s) == before + 2);

        nts_release((NtsHeader *)result);
        nts_release((NtsHeader *)array);
        nts_release((NtsHeader *)source);
        nts_collect_cycles();
        check("releasing every promise gives it back", rc(s) == before);
        nts_release((NtsHeader *)s);
    }

    printf("%s\n", failures == 0 ? "all ok" : "failures");
    return failures == 0 ? 0 : 1;
}
