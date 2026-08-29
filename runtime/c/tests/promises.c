/* Promise ordering, against what node actually does.
 *
 * Every expected sequence is transcribed from node, with the program that
 * produced it beside it, run as CommonJS -- ES module evaluation is itself a
 * microtask job, so the same probe as `.mjs` reports a different order for
 * reasons that have nothing to do with promises.
 */
#include <stdio.h>
#include <string.h>

#include "nts_test_host.h"

static char trace[512];
static int failures;

static void note(const char *what) {
    if (trace[0]) {
        strncat(trace, " -> ", sizeof(trace) - strlen(trace) - 1);
    }
    strncat(trace, what, sizeof(trace) - strlen(trace) - 1);
}

static void expect(const char *what, const char *want) {
    if (strcmp(trace, want) != 0) {
        printf("FAIL %s\n  got  %s\n  want %s\n", what, trace, want);
        failures++;
    } else {
        printf("ok   %s\n", what);
    }
}

static void reset(void) {
    trace[0] = '\0';
    nts_test_host_install();
}

static void say(void *state) { note((const char *)state); }

static NtsTask reaction(const char *label) {
    NtsTask task;
    task.run = say;
    task.drop = 0;
    task.state = (void *)label;
    return task;
}

/*   const p = Promise.resolve();
 *   p.then(() => o.push("a"));
 *   p.then(() => o.push("b"));
 *   o.push("sync");
 *                                  sync -> a -> b                            */
static void reactions_run_in_subscription_order(void) {
    reset();
    NtsPromise *p = nts_promise_new();
    nts_promise_fulfill_void(p);
    nts_promise_subscribe(p, reaction("a"));
    nts_promise_subscribe(p, reaction("b"));
    note("sync");
    nts_test_host_run(64);
    expect("reactions run in subscription order", "sync -> a -> b");
    nts_release((NtsHeader *)p);
}

/* The case the previous one does *not* reach: subscribing to a promise that is
 * still pending, which is the path that goes through the reaction chain.
 *
 * Written because sabotaging the chain's ordering broke nothing. Every other
 * test here subscribes to an already-settled promise, which goes straight to
 * the microtask queue and never touches the chain -- so the code that puts the
 * chain back into subscription order had no case reaching it, and reversing it
 * to LIFO passed the whole suite.
 *
 *   const p = new Promise((r) => { go = r; });
 *   p.then(() => o.push("a"));
 *   p.then(() => o.push("b"));
 *   p.then(() => o.push("c"));
 *   go();
 *                                  a -> b -> c                               */
static void a_pending_promise_keeps_subscription_order(void) {
    reset();
    NtsPromise *p = nts_promise_new();
    nts_promise_subscribe(p, reaction("a"));
    nts_promise_subscribe(p, reaction("b"));
    nts_promise_subscribe(p, reaction("c"));
    nts_promise_fulfill_void(p);
    nts_test_host_run(64);
    expect("a pending promise keeps subscription order", "a -> b -> c");
    nts_release((NtsHeader *)p);
}

/*   Promise.resolve().then(() => o.push("first"));
 *   settled.then(() => o.push("on-settled"));
 *   Promise.resolve().then(() => o.push("third"));
 *                                  first -> on-settled -> third              */
static void subscribing_to_a_settled_promise_still_defers(void) {
    reset();
    NtsPromise *first = nts_promise_new();
    NtsPromise *settled = nts_promise_new();
    NtsPromise *third = nts_promise_new();
    nts_promise_fulfill_void(first);
    nts_promise_fulfill_void(settled);
    nts_promise_fulfill_void(third);
    nts_promise_subscribe(first, reaction("first"));
    nts_promise_subscribe(settled, reaction("on-settled"));
    nts_promise_subscribe(third, reaction("third"));
    nts_test_host_run(64);
    expect("a settled promise defers its reaction by a microtask",
           "first -> on-settled -> third");
    nts_release((NtsHeader *)first);
    nts_release((NtsHeader *)settled);
    nts_release((NtsHeader *)third);
}

/*   p.then(() => o.push("reaction"));
 *   o.push("before"); go(); o.push("after");
 *                                  before -> after -> reaction               */
static void resolving_does_not_run_reactions_inline(void) {
    reset();
    NtsPromise *p = nts_promise_new();
    nts_promise_subscribe(p, reaction("reaction"));
    note("before");
    nts_promise_fulfill_void(p);
    note("after");
    nts_test_host_run(64);
    expect("resolving defers its reactions", "before -> after -> reaction");
    nts_release((NtsHeader *)p);
}

/*   p.then(() => o.push("fulfilled"), () => o.push("rejected"));
 *   go(); no(); go();
 *                                  fulfilled                                 */
static void a_promise_settles_once(void) {
    reset();
    NtsPromise *p = nts_promise_new();
    nts_promise_subscribe(p, reaction("fulfilled"));
    nts_promise_fulfill_void(p);
    nts_promise_reject(p, 0);
    nts_promise_fulfill_void(p);
    nts_test_host_run(64);
    expect("a promise settles once", "fulfilled");
    if (p->state != NTS_PROMISE_FULFILLED) {
        printf("FAIL the later reject changed the state\n");
        failures++;
    } else {
        printf("ok   the later settle was ignored\n");
    }
    nts_release((NtsHeader *)p);
}

/*   a.then(() => o.push("a")); b.then(() => o.push("b"));
 *   goB(); goA();
 *                                  b -> a                                    */
static void order_follows_resolution_not_subscription(void) {
    reset();
    NtsPromise *a = nts_promise_new();
    NtsPromise *b = nts_promise_new();
    nts_promise_subscribe(a, reaction("a"));
    nts_promise_subscribe(b, reaction("b"));
    nts_promise_fulfill_void(b);
    nts_promise_fulfill_void(a);
    nts_test_host_run(64);
    expect("across promises, resolution order wins", "b -> a");
    nts_release((NtsHeader *)a);
    nts_release((NtsHeader *)b);
}

/* The payload survives, and says which slot is live. Not an ordering
 * question, but the tag is what tells the collector whether `reference` is
 * one, so a wrong tag is a leak or a double free rather than a wrong number. */
static void the_payload_carries_its_tag(void) {
    reset();
    NtsPromise *number = nts_promise_new();
    nts_promise_fulfill_number(number, 42.5);
    if (nts_value_tag(number->value) != NTS_TAG_NUMBER ||
        nts_value_number(number->value) != 42.5) {
        printf("FAIL a number payload did not survive\n");
        failures++;
    } else {
        printf("ok   a number payload survives with its tag\n");
    }
    NtsPromise *empty = nts_promise_new();
    nts_promise_fulfill_void(empty);
    if (nts_value_tag(empty->value) != NTS_TAG_UNDEFINED) {
        printf("FAIL a void payload claimed a slot\n");
        failures++;
    } else {
        printf("ok   a void payload claims no slot\n");
    }
    nts_release((NtsHeader *)number);
    nts_release((NtsHeader *)empty);
}

/* The reaction chain is hand-written ownership, so it is worth asking whether
 * it balances rather than assuming. Under reference counting, a promise that
 * settled and was released should leave nothing behind -- including the
 * reaction objects, which the chain allocated and the scheduler frees.
 *
 * Cycles are not the question here: nothing in this file makes one. What this
 * catches is a missing release on the reaction, which is the easy mistake. */
static void the_reaction_chain_balances(void) {
    reset();
    size_t before = nts_live_bytes();
    for (int i = 0; i < 100; i++) {
        NtsPromise *p = nts_promise_new();
        nts_promise_subscribe(p, reaction("x"));
        nts_promise_subscribe(p, reaction("y"));
        nts_promise_fulfill_number(p, (double)i);
        nts_release((NtsHeader *)p);
    }
    trace[0] = '\0';
    nts_test_host_run(1024);
    size_t after = nts_live_bytes();
    if (after != before) {
        printf("FAIL the reaction chain leaked %zu bytes over 100 promises\n",
               after - before);
        failures++;
    } else {
        printf("ok   the reaction chain balances\n");
    }
}

int main(void) {
    reactions_run_in_subscription_order();
    a_pending_promise_keeps_subscription_order();
    subscribing_to_a_settled_promise_still_defers();
    resolving_does_not_run_reactions_inline();
    a_promise_settles_once();
    order_follows_resolution_not_subscription();
    the_payload_carries_its_tag();
    the_reaction_chain_balances();
    if (failures) {
        printf("%d failure(s)\n", failures);
        return 1;
    }
    printf("all promise checks agree with node\n");
    return 0;
}
