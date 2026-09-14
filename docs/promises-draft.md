# C Promises

A small Promise runtime for C with JavaScript-style Promise semantics.

The goal is that application code never manually pumps a queue, calls a checkpoint, or owns an event loop. The runtime is entered once through `async_run()`, and Promise reactions are scheduled as microtasks exactly as they are in JavaScript.

## Public API

```c
#ifndef PROMISE_H
#define PROMISE_H

#include <stddef.h>

typedef struct promise promise_t;

typedef struct {
    int domain;
    int code;
    void *data;
} promise_error_t;

typedef enum {
    PROMISE_FULFILLED,
    PROMISE_REJECTED
} promise_result_kind_t;

typedef struct {
    promise_result_kind_t kind;

    union {
        void *value;
        promise_error_t error;
    };
} promise_result_t;


/*
 * Promise executor
 *
 * Equivalent to:
 *
 *   new Promise((resolve, reject) => { ... })
 *
 * The executor is called synchronously by promise_new().
 * resolve/reject may be retained by the asynchronous operation and invoked later.
 */
typedef struct promise_resolver promise_resolver_t;

typedef void (*promise_executor_fn)(
    promise_resolver_t *resolver,
    void *ctx
);

promise_t *promise_new(
    promise_executor_fn executor,
    void *ctx
);

void promise_resolver_resolve(
    promise_resolver_t *resolver,
    void *value
);

void promise_resolver_reject(
    promise_resolver_t *resolver,
    promise_error_t error
);

void promise_resolver_resolve_promise(
    promise_resolver_t *resolver,
    promise_t *promise
);

promise_resolver_t *promise_resolver_retain(
    promise_resolver_t *resolver
);

void promise_resolver_release(
    promise_resolver_t *resolver
);


/*
 * Promise.then()
 *
 * on_fulfilled may return another Promise. The returned Promise adopts
 * that Promise's eventual state, matching JavaScript Promise resolution.
 *
 * Passing NULL for either handler means "forward that result unchanged".
 */
typedef promise_t *(*promise_fulfilled_fn)(
    void *value,
    void *ctx
);

typedef promise_t *(*promise_rejected_fn)(
    promise_error_t error,
    void *ctx
);

promise_t *promise_then(
    promise_t *promise,
    promise_fulfilled_fn on_fulfilled,
    promise_rejected_fn on_rejected,
    void *ctx
);


/* Promise.catch() */
promise_t *promise_catch(
    promise_t *promise,
    promise_rejected_fn on_rejected,
    void *ctx
);


/* Promise.finally() */
typedef void (*promise_finally_fn)(void *ctx);

promise_t *promise_finally(
    promise_t *promise,
    promise_finally_fn on_finally,
    void *ctx
);


/* Promise.resolve() / Promise.reject() */
promise_t *promise_resolve(void *value);

promise_t *promise_reject(
    promise_error_t error
);


/* Promise.all() */
promise_t *promise_all(
    promise_t *const promises[],
    size_t count
);


/* Promise.allSettled() */
promise_t *promise_all_settled(
    promise_t *const promises[],
    size_t count
);


/* Promise.race() */
promise_t *promise_race(
    promise_t *const promises[],
    size_t count
);


/* Promise.any() */
promise_t *promise_any(
    promise_t *const promises[],
    size_t count
);


/* Lifetime */
promise_t *promise_retain(
    promise_t *promise
);

void promise_release(
    promise_t *promise
);


/*
 * Host runtime
 *
 * Equivalent to running a JavaScript program inside a host that owns
 * the event loop and microtask queue.
 *
 * async_run() returns after the root Promise settles and the final
 * microtask checkpoint has completed.
 */
typedef promise_t *(*async_main_fn)(void *ctx);

int async_run(
    async_main_fn main_fn,
    void *ctx
);

#endif
```

## Basic usage

Application code enters the runtime once:

```c
static promise_t *
program(void *ctx)
{
    promise_t *p = http_get("https://example.com/user");

    p = promise_then(
        p,
        parse_user,
        NULL,
        NULL
    );

    p = promise_then(
        p,
        fetch_avatar,
        NULL,
        NULL
    );

    p = promise_catch(
        p,
        report_error,
        NULL
    );

    return p;
}

int
main(void)
{
    return async_run(program, NULL);
}
```

No event-loop code is required in application code.

There is no:

```c
while (...) {
    ...
}
```

and no:

```c
promise_checkpoint();
```

The runtime owns both.

## Returning values

JavaScript handlers may return either a normal value or another Promise.

In C, `promise_then()` handlers always return a `promise_t *`.

For an immediate value, return `promise_resolve()`:

```c
static promise_t *
parse_user(void *value, void *ctx)
{
    http_response_t *response = value;

    user_t *user = user_parse(response->body);

    if (!user) {
        return promise_reject((promise_error_t) {
            .domain = ERROR_JSON,
            .code = JSON_INVALID
        });
    }

    return promise_resolve(user);
}
```

For another asynchronous operation, return its Promise directly:

```c
static promise_t *
fetch_avatar(void *value, void *ctx)
{
    user_t *user = value;

    return http_get(user->avatar_url);
}
```

This corresponds to:

```js
fetch("/user")
  .then(parseUser)
  .then((user) => fetch(user.avatarUrl));
```

## Creating a Promise

`promise_new()` is the C equivalent of the JavaScript Promise constructor.

```c
typedef struct {
    promise_resolver_t *resolver;
    timer_t timer;
} sleep_op_t;

static void
sleep_complete(void *arg)
{
    sleep_op_t *op = arg;

    promise_resolver_resolve(
        op->resolver,
        NULL
    );

    promise_resolver_release(op->resolver);
    free(op);
}

static void
sleep_executor(
    promise_resolver_t *resolver,
    void *ctx
)
{
    uint64_t milliseconds =
        *(uint64_t *)ctx;

    sleep_op_t *op =
        calloc(1, sizeof *op);

    op->resolver =
        promise_resolver_retain(resolver);

    timer_start(
        &op->timer,
        milliseconds,
        sleep_complete,
        op
    );
}

promise_t *
async_sleep(uint64_t milliseconds)
{
    return promise_new(
        sleep_executor,
        &milliseconds
    );
}
```

The executor itself runs synchronously, just like:

```js
new Promise((resolve, reject) => {
    ...
});
```

Calling `resolve` or `reject`, however, never invokes `.then()` handlers synchronously.

## Microtask semantics

Promise reactions follow JavaScript ordering.

For example:

```c
static promise_t *
handler(void *value, void *ctx)
{
    puts("then");
    return promise_resolve(NULL);
}

static promise_t *
program(void *ctx)
{
    promise_t *p = promise_resolve(NULL);

    puts("A");

    promise_t *next =
        promise_then(p, handler, NULL, NULL);

    puts("B");

    return next;
}
```

prints:

```text
A
B
then
```

Even though `p` is already fulfilled, its handler is queued as a microtask rather than called inline.

The same rule applies when resolving a pending Promise:

```c
promise_resolver_resolve(resolver, value);
```

only settles the Promise and queues its reactions. User callbacks run after the current host task returns.

## `async_run()`

`async_run()` is the host environment for the Promise runtime.

Conceptually it performs:

```c
int
async_run(async_main_fn main_fn, void *ctx)
{
    runtime_t runtime;

    runtime_init(&runtime);
    runtime_enter(&runtime);

    promise_t *root =
        main_fn(ctx);

    microtasks_drain(&runtime);

    while (!promise_is_settled(root)) {
        event_t event;

        runtime_wait_for_event(
            &runtime,
            &event
        );

        runtime_dispatch_event(
            &runtime,
            &event
        );

        microtasks_drain(&runtime);
    }

    /*
     * If resolving the root Promise queued more microtasks,
     * complete that checkpoint before shutting down.
     */
    microtasks_drain(&runtime);

    int status =
        promise_exit_status(root);

    runtime_leave(&runtime);
    runtime_destroy(&runtime);

    return status;
}
```

This loop is an implementation detail. It is never written by application code.

The runtime provides two kinds of work:

```text
host tasks
    I/O completions
    timers
    worker-thread completions
    runtime events

microtasks
    Promise reactions
    chained Promise resolution
    catch/finally handlers
```

After each host task, the runtime drains the microtask queue completely before waiting for the next host task.

Conceptually:

```text
host task
   |
   v
user callback
   |
   v
Promise settles
   |
   v
microtask
   |
   +----> may queue another microtask
   |
   v
queue empty
   |
   v
next host task
```

This is the scheduling model used by JavaScript Promises.

## `Promise.all()`

```c
static promise_t *
program(void *ctx)
{
    promise_t *requests[] = {
        http_get("https://example.com/user"),
        http_get("https://example.com/settings"),
        http_get("https://example.com/messages")
    };

    return promise_all(
        requests,
        sizeof requests / sizeof requests[0]
    );
}
```

The returned Promise fulfills when every input fulfills and rejects when the first input rejects.

Its fulfillment value may be represented by the library as a result-array object containing the input values in the original order.

## `Promise.race()`

```c
static promise_t *
program(void *ctx)
{
    promise_t *operations[] = {
        http_get("https://primary.example.com/data"),
        http_get("https://backup.example.com/data")
    };

    return promise_race(
        operations,
        sizeof operations / sizeof operations[0]
    );
}
```

The returned Promise settles as soon as the first input Promise settles.

## `Promise.any()`

```c
static promise_t *
program(void *ctx)
{
    promise_t *mirrors[] = {
        fetch_from_mirror_a(),
        fetch_from_mirror_b(),
        fetch_from_mirror_c()
    };

    return promise_any(
        mirrors,
        sizeof mirrors / sizeof mirrors[0]
    );
}
```

The returned Promise fulfills with the first fulfilled input.

It rejects only if every input rejects.

## `Promise.allSettled()`

```c
static promise_t *
program(void *ctx)
{
    promise_t *jobs[] = {
        upload_a(),
        upload_b(),
        upload_c()
    };

    return promise_all_settled(
        jobs,
        sizeof jobs / sizeof jobs[0]
    );
}
```

The returned Promise fulfills after every input has settled, regardless of whether individual inputs fulfilled or rejected.

## Chaining

Every call to `promise_then()`, `promise_catch()`, and `promise_finally()` creates and returns a new Promise.

```c
promise_t *p =
    http_get(url);

promise_t *p2 =
    promise_then(
        p,
        parse_response,
        NULL,
        NULL
    );

promise_t *p3 =
    promise_then(
        p2,
        process_response,
        NULL,
        NULL
    );

promise_t *p4 =
    promise_catch(
        p3,
        handle_error,
        NULL
    );
```

A handler returning another Promise causes the newly created Promise to adopt that Promise's eventual state.

That is:

```c
static promise_t *
load_profile(void *value, void *ctx)
{
    user_t *user = value;

    return http_get(user->profile_url);
}
```

has the same chaining behavior as:

```js
.then(user => fetch(user.profileUrl))
```

## Threading

A useful default model is:

- one `async_run()` runtime belongs to one thread;
- Promise handlers execute only on that runtime thread;
- external worker threads may complete asynchronous operations;
- those completions are posted back to the runtime;
- Promise reactions still execute as microtasks on the runtime thread.

This keeps Promise callbacks single-threaded while still allowing asynchronous work to happen elsewhere.

## Runtime lifetime

`async_run()` uses the Promise returned by `main_fn` as the root Promise.

```c
static promise_t *
program(void *ctx)
{
    return perform_application_work();
}
```

The runtime remains alive until that Promise settles.

This makes application lifetime explicit and avoids keeping the process alive merely because an unrelated timer or abandoned operation still exists.

Before returning, `async_run()` completes the current microtask checkpoint so that microtasks queued by the root Promise's settlement are not abandoned.

## Design rules

The public Promise API follows JavaScript semantics:

- executors run synchronously;
- Promise handlers never run synchronously;
- `.then()`, `.catch()`, and `.finally()` return new Promises;
- resolving with another Promise adopts its state;
- Promise reactions execute as microtasks;
- microtasks are drained completely between host tasks;
- `all`, `allSettled`, `race`, and `any` behave like their JavaScript counterparts;
- application code never manually pumps the Promise queue.

`async_run()` is the host runtime that makes those semantics possible in C.
