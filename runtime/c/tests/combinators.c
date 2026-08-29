/* `Promise.all` and `Promise.race`, against what node actually does.
 *
 * Every expected sequence is transcribed from node, with the program that
 * produced it beside it, run as CommonJS. Combinators are worth this
 * treatment more than plain promises are: `all` settles one tick after its
 * last element rather than with it, and that tick is invisible to any test
 * that only checks the value.
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

/* One `.then`, as a managed object.
 *
 * A bare pointer would be cheaper and is what the plain promise suite uses,
 * but it only survives there because every promise in it settles: a promise
 * freed while pending frees its reactions, which release their state. One of
 * the cases below is `Promise.race([])`, which never settles -- so the state
 * has to be a real object or the test would corrupt the heap proving that
 * nothing happens. */
typedef struct {
    NtsHeader header;
    /* What it was subscribed to, so it can report the settled value. */
    NtsPromise *source;
    /* Fulfilled once the label is noted, which is what makes a chain. */
    NtsPromise *next;
    const char *label;
    /* Whether to report the value as well as the label. */
    int report;
} Step;

static const uint32_t step_offsets[] = {
    (uint32_t)offsetof(Step, source),
    (uint32_t)offsetof(Step, next),
};

static const NtsDescriptor desc_step = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(Step), 2u, 1u, step_offsets, 0, "Step", 0u, 0,
};

/* The result array of an `all` over number payloads. */
static const NtsDescriptor desc_numbers = {
    NTS_KIND_ARRAY, (uint32_t)sizeof(double), 0u, 0u, 0, 0, "number[]", 0u, 0,
};

static void step_run(void *state) {
    Step *step = (Step *)state;
    char line[128];
    if (!step->report) {
        note(step->label);
    } else if (step->source->state == NTS_PROMISE_REJECTED) {
        snprintf(line, sizeof(line), "%s rejected", step->label);
        note(line);
    } else if (step->source->value.tag == NTS_TAG_NUMBER) {
        snprintf(line, sizeof(line), "%s %g", step->label,
                 step->source->value.as.number);
        note(line);
    } else {
        NtsArray *values = (NtsArray *)step->source->value.as.reference;
        size_t used = (size_t)snprintf(line, sizeof(line), "%s ", step->label);
        for (uint32_t i = 0; i < values->header.length && used < sizeof(line); i++) {
            used += (size_t)snprintf(line + used, sizeof(line) - used, "%s%g",
                                     i ? "," : "",
                                     NTS_ITEMS(values, double)[i]);
        }
        if (values->header.length == 0) {
            snprintf(line + used, sizeof(line) - used, "[]");
        }
        note(line);
    }
    if (step->next) {
        nts_promise_fulfill_void(step->next);
    }
    nts_release((NtsHeader *)step);
}

static void step_drop(void *state) { nts_release((NtsHeader *)state); }

static void then(NtsPromise *on, const char *label, NtsPromise *next, int report) {
    Step *step = (Step *)nts_object_new(&desc_step);
    step->label = label;
    step->report = report;
    step->source = on;
    nts_retain((NtsHeader *)on);
    step->next = next;
    if (next) {
        nts_retain((NtsHeader *)next);
    }
    nts_promise_subscribe(on, (NtsTask){step_run, step_drop, step});
}

/* `Promise.resolve().then(t1).then(t2).then(t3)`, subscribed up front the way
 * `.then` does: the intermediate promises exist before any reaction runs. */
static NtsPromise *chain[4];

static void start_chain(int depth) {
    for (int i = 0; i <= depth; i++) {
        chain[i] = nts_promise_new();
    }
    nts_promise_fulfill_void(chain[0]);
    static const char *labels[] = {"t1", "t2", "t3"};
    for (int i = 0; i < depth; i++) {
        then(chain[i], labels[i], i + 1 < depth ? chain[i + 1] : 0, 0);
    }
}

static void end_chain(int depth) {
    for (int i = 0; i <= depth; i++) {
        nts_release((NtsHeader *)chain[i]);
    }
}

static NtsArray *promise_array(NtsPromise **items, uint32_t count) {
    NtsArray *array = nts_array_new(&nts_desc_ref, count);
    for (uint32_t i = 0; i < count; i++) {
        nts_retain((NtsHeader *)items[i]);
        NTS_ITEMS(array, NtsHeader *)[i] = (NtsHeader *)items[i];
    }
    return array;
}

/*   Promise.all([Promise.resolve(1), Promise.resolve(2)]).then(v => t("all " + v));
 *   Promise.resolve().then(()=>t("t1")).then(()=>t("t2")).then(()=>t("t3"));
 * node: t1 -> all 1,2 -> t2 -> t3
 *
 * The tick that makes this worth a test: `all` waits for both elements, which
 * costs one microtask, and then settles its own promise, which costs another.
 * A combinator that resolved inline would print `all 1,2` before `t1`. */
static void all_of_two_settled_costs_one_tick_more_than_a_then(void) {
    reset();
    NtsPromise *elements[2] = {nts_promise_new(), nts_promise_new()};
    nts_promise_fulfill_number(elements[0], 1);
    nts_promise_fulfill_number(elements[1], 2);
    NtsArray *array = promise_array(elements, 2);
    NtsPromise *all = nts_promise_all(array, nts_array_new(&desc_numbers, array->header.length));
    then(all, "all", 0, 1);
    start_chain(3);
    nts_test_host_run(64);
    expect("`all` of two settled promises lands between t1 and t2",
           "t1 -> all 1,2 -> t2 -> t3");
    end_chain(3);
    nts_release((NtsHeader *)all);
    nts_release((NtsHeader *)array);
    nts_release((NtsHeader *)elements[0]);
    nts_release((NtsHeader *)elements[1]);
}

/*   const a = new Promise(r => r1 = r), b = new Promise(r => r2 = r);
 *   Promise.all([a, b]).then(v => t("all " + v));
 *   a.then(() => t("a settled")); b.then(() => t("b settled"));
 *   r2(2); t("resolved b"); r1(1); t("resolved a");
 * node: resolved b -> resolved a -> b settled -> a settled -> all 1,2
 *
 * `b` settles first and is second in the result. Completion order and input
 * order differ here on purpose: they agree in most tests, which is what makes
 * a combinator that returns completion order pass them. */
static void all_reports_input_order_not_completion_order(void) {
    reset();
    NtsPromise *elements[2] = {nts_promise_new(), nts_promise_new()};
    NtsArray *array = promise_array(elements, 2);
    NtsPromise *all = nts_promise_all(array, nts_array_new(&desc_numbers, array->header.length));
    then(all, "all", 0, 1);
    then(elements[0], "a settled", 0, 0);
    then(elements[1], "b settled", 0, 0);
    nts_promise_fulfill_number(elements[1], 2);
    note("resolved b");
    nts_promise_fulfill_number(elements[0], 1);
    note("resolved a");
    nts_test_host_run(64);
    expect("`all` reports input order when completion order differs",
           "resolved b -> resolved a -> b settled -> a settled -> all 1,2");
    nts_release((NtsHeader *)all);
    nts_release((NtsHeader *)array);
    nts_release((NtsHeader *)elements[0]);
    nts_release((NtsHeader *)elements[1]);
}

/*   Promise.all([]).then(v => t("all " + JSON.stringify(v)));
 *   Promise.resolve().then(()=>t("t1")).then(()=>t("t2"));
 * node: all [] -> t1 -> t2
 *
 * `all []` runs first, ahead of a reaction on an already-resolved promise
 * subscribed after it -- so the empty case is fulfilled by the time the call
 * returns, not one tick later. */
static void an_empty_all_is_fulfilled_before_it_returns(void) {
    reset();
    NtsArray *array = nts_array_new(&nts_desc_ref, 0);
    NtsPromise *all = nts_promise_all(array, nts_array_new(&desc_numbers, array->header.length));
    then(all, "all", 0, 1);
    start_chain(2);
    nts_test_host_run(64);
    expect("an empty `all` is fulfilled before it returns", "all [] -> t1 -> t2");
    end_chain(2);
    nts_release((NtsHeader *)all);
    nts_release((NtsHeader *)array);
}

/*   Promise.race([Promise.resolve("a"), Promise.resolve("b")]).then(v => t("race " + v));
 *   Promise.resolve().then(()=>t("t1")).then(()=>t("t2"));
 * node: t1 -> race a -> t2
 *
 * Both are settled, so the winner is subscription order, which is input
 * order. */
static void race_takes_the_first_element_when_both_are_settled(void) {
    reset();
    NtsPromise *elements[2] = {nts_promise_new(), nts_promise_new()};
    nts_promise_fulfill_number(elements[0], 1);
    nts_promise_fulfill_number(elements[1], 2);
    NtsArray *array = promise_array(elements, 2);
    NtsPromise *race = nts_promise_race(array);
    then(race, "race", 0, 1);
    start_chain(2);
    nts_test_host_run(64);
    expect("`race` takes the first element when both are settled",
           "t1 -> race 1 -> t2");
    end_chain(2);
    nts_release((NtsHeader *)race);
    nts_release((NtsHeader *)array);
    nts_release((NtsHeader *)elements[0]);
    nts_release((NtsHeader *)elements[1]);
}

/*   Promise.all([Promise.reject(new Error("boom")), slow]).then(..., e => t("rejected " + e.message));
 *   Promise.resolve().then(()=>t("t1")).then(()=>{t("t2"); r1(9);}).then(()=>t("t3"));
 * node: t1 -> rejected boom -> t2 -> t3
 *
 * The element that fulfils afterwards does not un-reject it, and does not
 * fulfil it either: `remaining` never reaches zero because a rejection does
 * not decrement it. */
static void all_rejects_on_the_first_rejection(void) {
    reset();
    NtsPromise *elements[2] = {nts_promise_new(), nts_promise_new()};
    NtsHeader *reason = nts_object_new(&desc_step);
    nts_promise_reject(elements[0], reason);
    NtsArray *array = promise_array(elements, 2);
    NtsPromise *all = nts_promise_all(array, nts_array_new(&desc_numbers, array->header.length));
    then(all, "all", 0, 1);
    start_chain(3);
    nts_test_host_run(64);
    /* The slow element settles after the result already has. */
    nts_promise_fulfill_number(elements[1], 9);
    nts_test_host_run(64);
    expect("`all` rejects on the first rejection and stays rejected",
           "t1 -> all rejected -> t2 -> t3");
    end_chain(3);
    nts_release((NtsHeader *)all);
    nts_release((NtsHeader *)array);
    nts_release((NtsHeader *)elements[0]);
    nts_release((NtsHeader *)elements[1]);
    nts_release(reason);
}

/*   Promise.race([]).then(() => t("race settled"));
 *   Promise.resolve().then(()=>t("t1")).then(()=>t("t2"));
 * node: t1 -> t2
 *
 * Nothing was subscribed, so nothing will settle it. Not a special case in
 * the implementation -- the absence of one. */
static void an_empty_race_never_settles(void) {
    reset();
    NtsArray *array = nts_array_new(&nts_desc_ref, 0);
    NtsPromise *race = nts_promise_race(array);
    then(race, "race settled", 0, 0);
    start_chain(2);
    nts_test_host_run(64);
    expect("an empty `race` never settles", "t1 -> t2");
    end_chain(2);
    nts_release((NtsHeader *)race);
    nts_release((NtsHeader *)array);
}

/* A combinator holds its elements, its slots and its result. All of it should
 * come back, including the case that never settles -- whose reactions are
 * freed by the promise rather than run.
 *
 * The cycle collector runs first because the cycles here are real, not an
 * accounting slip: a slot holds the combinator, the combinator holds the
 * result promise, and the result promise holds reactions whose state is a
 * slot. That is the shape `cyclic` on the descriptor exists to declare, and
 * measuring without collecting would be measuring the wrong thing. */
static void combinators_give_their_memory_back(void) {
    reset();
    nts_collect_cycles();
    size_t before = nts_live_bytes();
    for (int round = 0; round < 100; round++) {
        NtsPromise *elements[2] = {nts_promise_new(), nts_promise_new()};
        nts_promise_fulfill_number(elements[0], 1);
        nts_promise_fulfill_number(elements[1], 2);
        NtsArray *array = promise_array(elements, 2);
        NtsPromise *all = nts_promise_all(array, nts_array_new(&desc_numbers, array->header.length));
        NtsPromise *race = nts_promise_race(array);
        NtsArray *empty = nts_array_new(&nts_desc_ref, 0);
        NtsPromise *stuck = nts_promise_race(empty);
        then(stuck, "never", 0, 0);
        nts_test_host_run(64);
        nts_release((NtsHeader *)stuck);
        nts_release((NtsHeader *)empty);
        nts_release((NtsHeader *)all);
        nts_release((NtsHeader *)race);
        nts_release((NtsHeader *)array);
        nts_release((NtsHeader *)elements[0]);
        nts_release((NtsHeader *)elements[1]);
    }
    nts_collect_cycles();
    size_t after = nts_live_bytes();
    if (after != before) {
        printf("FAIL combinators leaked %zu bytes over 100 rounds\n",
               after - before);
        failures++;
    } else {
        printf("ok   combinators give their memory back\n");
    }
}

int main(void) {
    all_of_two_settled_costs_one_tick_more_than_a_then();
    all_reports_input_order_not_completion_order();
    an_empty_all_is_fulfilled_before_it_returns();
    race_takes_the_first_element_when_both_are_settled();
    all_rejects_on_the_first_rejection();
    an_empty_race_never_settles();
    combinators_give_their_memory_back();
    if (failures) {
        printf("%d failure(s)\n", failures);
        return 1;
    }
    printf("all combinator checks agree with node\n");
    return 0;
}
