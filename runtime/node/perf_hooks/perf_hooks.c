#include "nts_perf_hooks.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

/* Node's numbering, from `src/node_perf_common.h`. */
enum {
    kMilestoneEnvironment = 2,
    kMilestoneNodeStart = 3,
    kMilestoneV8Start = 4,
    kMilestoneLoopStart = 5,
    kMilestoneLoopExit = 6,
    kMilestoneBootstrapComplete = 7,
};

static uint64_t origin_ns;
static double origin_epoch_ms;

/* Taken before `main`, and in the same instant on both clocks, so that
 * `timeOrigin + now()` is a wall-clock time the moment it is read. */
__attribute__((constructor)) static void nts_perf_hooks_capture_origin(void) {
    origin_ns = uv_hrtime();
    uv_timeval64_t now;
    if (uv_gettimeofday(&now) == 0) {
        origin_epoch_ms = (double)now.tv_sec * 1e3 + (double)now.tv_usec / 1e3;
    }
}

static double since_origin_ms(uint64_t ns) { return (double)(ns - origin_ns) / 1e6; }

/* The loop, observed. Installed on the first question anything asks about it:
 * idle-time accounting has to be switched on before there is idle time to
 * account, and the first prepare callback is how the loop's start is seen. */
static bool loop_observed;
static uv_prepare_t loop_start_probe;
static uint64_t loop_start_ns;

static void nts_perf_hooks_loop_started(uv_prepare_t *handle) {
    loop_start_ns = uv_hrtime();
    uv_prepare_stop(handle);
}

static uv_loop_t *nts_perf_hooks_loop(void) {
    uv_loop_t *loop = uv_default_loop();
    if (!loop_observed) {
        loop_observed = true;
        /* Harmless when it is already on, as it is in node. */
        (void)uv_loop_configure(loop, UV_METRICS_IDLE_TIME);
        if (uv_prepare_init(loop, &loop_start_probe) == 0) {
            (void)uv_prepare_start(&loop_start_probe, nts_perf_hooks_loop_started);
            uv_unref((uv_handle_t *)&loop_start_probe);
        }
    }
    return loop;
}

/* Observing starts with the module rather than with its first question, so
 * that the loop's first iteration is not missed by a program that asks only
 * after it. */
__attribute__((constructor)) static void nts_perf_hooks_observe_loop(void) {
    (void)nts_perf_hooks_loop();
}

double nts_perf_hooks_now(void) { return since_origin_ms(uv_hrtime()); }

double nts_perf_hooks_time_origin(void) { return origin_epoch_ms; }

double nts_perf_hooks_milestone(double milestone) {
    (void)nts_perf_hooks_loop();
    switch ((int)milestone) {
    case kMilestoneNodeStart:
        return 0;
    case kMilestoneLoopStart:
        return loop_start_ns == 0 ? -1 : since_origin_ms(loop_start_ns);
    case kMilestoneEnvironment:
    case kMilestoneV8Start:
    case kMilestoneLoopExit:
    case kMilestoneBootstrapComplete:
    default:
        return -1;
    }
}

double nts_perf_hooks_loop_idle_time(void) {
    return (double)uv_metrics_idle_time(nts_perf_hooks_loop()) / 1e6;
}

double nts_perf_hooks_uv_metric(double field) {
    uv_metrics_t metrics;
    memset(&metrics, 0, sizeof metrics);
    if (uv_metrics_info(nts_perf_hooks_loop(), &metrics) != 0) {
        return 0;
    }
    switch ((int)field) {
    case 0:
        return (double)metrics.loop_count;
    case 1:
        return (double)metrics.events;
    case 2:
        return (double)metrics.events_waiting;
    default:
        return 0;
    }
}

/* Node's `IterationHistogram` (`src/histogram.cc`): a prepare handle notes when
 * the loop is about to poll and for how long it may, a check handle notes when
 * it came back, and each check records the latency since the previous check --
 * how long the rest of the iteration held the loop -- plus however far the poll
 * overran its timeout. Both handles are unreferenced, so sampling never keeps a
 * process alive.
 *
 * The samples wait here until the program reads the histogram, rather than
 * being handed over one per iteration: calling into the program from every
 * iteration would put the cost of measuring the loop inside what is measured. */
typedef struct IterationSampler {
    uv_prepare_t prepare;
    uv_check_t check;
    uint64_t prepare_time;
    uint64_t check_time;
    int64_t timeout;
    uint64_t *samples;
    size_t head;
    size_t length;
    size_t capacity;
    int open_handles;
} IterationSampler;

static IterationSampler **samplers;
static size_t sampler_count;

static void nts_perf_hooks_iteration_prepare(uv_prepare_t *handle) {
    IterationSampler *self = handle->data;
    self->prepare_time = uv_hrtime();
    self->timeout = uv_backend_timeout(handle->loop);
}

static void nts_perf_hooks_push_sample(IterationSampler *self, uint64_t sample) {
    if (self->head + self->length == self->capacity) {
        if (self->head > 0) {
            memmove(self->samples, self->samples + self->head, self->length * sizeof *self->samples);
            self->head = 0;
        } else {
            size_t capacity = self->capacity == 0 ? 64 : self->capacity * 2;
            uint64_t *grown = realloc(self->samples, capacity * sizeof *grown);
            if (grown == NULL) {
                return; /* An unrecorded sample, not a failed program. */
            }
            self->samples = grown;
            self->capacity = capacity;
        }
    }
    self->samples[self->head + self->length] = sample;
    self->length++;
}

static void nts_perf_hooks_iteration_check(uv_check_t *handle) {
    IterationSampler *self = handle->data;
    uint64_t check_time = uv_hrtime();
    uint64_t poll_time = check_time - self->prepare_time;
    uint64_t latency = self->prepare_time - self->check_time;
    if (self->timeout >= 0) {
        uint64_t timeout_ns = (uint64_t)self->timeout * 1000 * 1000;
        if (poll_time > timeout_ns) {
            latency += poll_time - timeout_ns;
        }
    }
    nts_perf_hooks_push_sample(self, latency == 0 ? 1 : latency);
    self->check_time = check_time;
}

static IterationSampler *nts_perf_hooks_sampler(double id) {
    size_t index = (size_t)id;
    if (id < 1 || index > sampler_count) {
        return NULL;
    }
    return samplers[index - 1];
}

double nts_perf_hooks_iteration_sampler_start(void) {
    uv_loop_t *loop = nts_perf_hooks_loop();
    IterationSampler *self = calloc(1, sizeof *self);
    if (self == NULL) {
        return -1;
    }
    size_t slot = 0;
    while (slot < sampler_count && samplers[slot] != NULL) {
        slot++;
    }
    if (slot == sampler_count) {
        IterationSampler **grown = realloc(samplers, (sampler_count + 1) * sizeof *grown);
        if (grown == NULL) {
            free(self);
            return -1;
        }
        samplers = grown;
        sampler_count++;
    }
    samplers[slot] = self;

    self->check_time = uv_hrtime();
    self->prepare_time = self->check_time;
    self->timeout = 0;
    self->prepare.data = self;
    self->check.data = self;
    uv_prepare_init(loop, &self->prepare);
    uv_check_init(loop, &self->check);
    self->open_handles = 2;
    uv_check_start(&self->check, nts_perf_hooks_iteration_check);
    uv_prepare_start(&self->prepare, nts_perf_hooks_iteration_prepare);
    uv_unref((uv_handle_t *)&self->check);
    uv_unref((uv_handle_t *)&self->prepare);
    return (double)(slot + 1);
}

static void nts_perf_hooks_sampler_closed(uv_handle_t *handle) {
    IterationSampler *self = handle->data;
    if (--self->open_handles == 0) {
        free(self->samples);
        free(self);
    }
}

void nts_perf_hooks_iteration_sampler_stop(double id) {
    IterationSampler *self = nts_perf_hooks_sampler(id);
    if (self == NULL) {
        return;
    }
    samplers[(size_t)id - 1] = NULL;
    uv_prepare_stop(&self->prepare);
    uv_check_stop(&self->check);
    uv_close((uv_handle_t *)&self->prepare, nts_perf_hooks_sampler_closed);
    uv_close((uv_handle_t *)&self->check, nts_perf_hooks_sampler_closed);
}

double nts_perf_hooks_iteration_sampler_take(double id) {
    IterationSampler *self = nts_perf_hooks_sampler(id);
    if (self == NULL || self->length == 0) {
        return 0;
    }
    uint64_t sample = self->samples[self->head];
    self->head++;
    self->length--;
    if (self->length == 0) {
        self->head = 0;
    }
    return (double)sample;
}
