/* `spawnSync`, over `uv_spawn` on a loop of its own.
 *
 * # Why a private loop
 *
 * The synchronous family must not run anything else while it waits. Spawning on
 * `uv_default_loop()` would pump every other handle the process has open --
 * `net` sockets, `fs` watchers, timers -- and `execSync` would then deliver
 * callbacks to unrelated modules in the middle of a call that is supposed to
 * block. A loop created here, run to completion and closed, cannot.
 *
 * # Reading until EOF, not until exit
 *
 * The child's `exit` and its pipes' EOF are separate events and arrive in either
 * order. Stopping at `exit` truncates whatever is still in the pipe buffer, which
 * shows up as intermittently short output on a child that writes and exits at
 * once. `uv_run(UV_RUN_DEFAULT)` returns when there are no active handles left,
 * which means after both pipes have closed *and* the process handle has been
 * reaped, so waiting on the loop itself is what waits for all three.
 */

#include "nts_child_process.h"

#include <stdlib.h>
#include <string.h>
#include <uv.h>

typedef struct {
    char *bytes;
    size_t length;
    size_t capacity;
    bool overflowed;
} Growable;

typedef struct {
    Growable out;
    Growable err;
    size_t max_buffer;
    int64_t status;
    int signal;
    bool exited;
    bool timed_out;
    uv_process_t process;
    uv_timer_t timer;
} Run;

static NtsString *utf8(const char *text) {
    return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

static char *cstring(const NtsString *value) {
    if (value == NULL) return NULL;
    size_t length = 0;
    return nts_node_to_utf8_alloc(value, &length);
}

/* Grows by doubling and stops at `max_buffer`, recording that it stopped.
 * Node's `maxBuffer` is an error rather than a truncation, so the flag has to
 * survive to the caller; dropping it silently would turn a failed command into a
 * successful one with short output. */
static void push(Growable *g, const char *bytes, size_t count, size_t max_buffer) {
    if (g->overflowed) return;
    if (max_buffer != 0 && g->length + count > max_buffer) {
        g->overflowed = true;
        return;
    }
    if (g->length + count > g->capacity) {
        size_t wanted = g->capacity == 0 ? 8192 : g->capacity;
        while (wanted < g->length + count) wanted *= 2;
        char *grown = realloc(g->bytes, wanted);
        if (grown == NULL) { g->overflowed = true; return; }
        g->bytes = grown;
        g->capacity = wanted;
    }
    memcpy(g->bytes + g->length, bytes, count);
    g->length += count;
}

static void on_alloc(uv_handle_t *handle, size_t suggested, uv_buf_t *buffer) {
    (void)handle;
    buffer->base = malloc(suggested);
    buffer->len = buffer->base == NULL ? 0 : suggested;
}

static void on_read(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
    Growable *target = (Growable *)stream->data;
    if (count > 0 && target != NULL) {
        Run *run = (Run *)stream->loop->data;
        push(target, buffer->base, (size_t)count, run == NULL ? 0 : run->max_buffer);
    }
    free(buffer->base);
    if (count < 0) uv_close((uv_handle_t *)stream, NULL);
}

/* Not `on_exit`: that is libc's, from <stdlib.h>, and a static of the same
 * name is a redeclaration with a different type. The same hazard as
 * `blockers/libc-name-collision`, in hand-written C this time. */
static void on_sync_exit(uv_process_t *process, int64_t status, int signal) {
    Run *run = (Run *)process->data;
    if (run != NULL) {
        run->status = status;
        run->signal = signal;
        run->exited = true;
        uv_timer_stop(&run->timer);
        uv_close((uv_handle_t *)&run->timer, NULL);
    }
    uv_close((uv_handle_t *)process, NULL);
}

/* `timeout` kills the child; it does not abandon it. Returning while the process
 * is still running would leak it past the call that created it, and node's
 * contract is that the child is dead by the time `spawnSync` returns. */
static void on_timeout(uv_timer_t *timer) {
    Run *run = (Run *)timer->data;
    if (run == NULL) return;
    run->timed_out = true;
    uv_process_kill(&run->process, SIGTERM);
}

static void on_write(uv_write_t *request, int status) {
    (void)status;
    uv_close((uv_handle_t *)request->handle, NULL);
    free(request);
}

static NtsView *bytes_view(const char *bytes, size_t length) {
    NtsBuffer *buffer = nts_buffer_new((double)length);
    if (buffer == NULL) return NULL;
    if (length != 0) memcpy(buffer->bytes, bytes, length);
    return nts_view_new(buffer, 0.0, (double)length, (double)NTS_ELEMENT_U8, false);
}

/* `error` is libuv's negative code rather than its name: node's `errno` is the
 * number and its `code` is the name, and the TypeScript has `errName` to turn one
 * into the other. Passing the name here meant `errno` was a string, which
 * `util.getSystemErrorName` refuses. */
static void call_result(NtsHeader *callback, double status, double signal,
                        NtsView *out, NtsView *err, double error, double pid) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, double, NtsView *, NtsView *, double, double))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, signal, out, err, error, pid);
}

/* A NULL-terminated `char *` vector from an array of strings. Each element is
 * owned and freed by `free_vector`. */
static char **vector_of(NtsArray *array, size_t *count_out) {
    size_t count = array == NULL ? 0 : (size_t)array->header.length;
    char **vector = calloc(count + 1, sizeof(char *));
    if (vector == NULL) { *count_out = 0; return NULL; }
    for (size_t index = 0; index < count; index++) {
        NtsString *item = (NtsString *)nts_array_at_ref(array, (double)index);
        vector[index] = cstring(item);
    }
    vector[count] = NULL;
    *count_out = count;
    return vector;
}

static void free_vector(char **vector, size_t count) {
    if (vector == NULL) return;
    for (size_t index = 0; index < count; index++) free(vector[index]);
    free(vector);
}

NtsHeader *nts_child_process_spawn_sync(const NtsString *file, NtsHeader *args,
                                        NtsHeader *env, const NtsString *cwd,
                                        NtsHeader *input, double timeout_ms,
                                        double max_buffer, NtsHeader *callback) {
    Run run;
    memset(&run, 0, sizeof(run));
    run.max_buffer = max_buffer > 0 ? (size_t)max_buffer : 0;
    run.status = -1;

    uv_loop_t loop;
    if (uv_loop_init(&loop) != 0) {
        call_result(callback, -1, 0, bytes_view(NULL, 0), bytes_view(NULL, 0),
                    (double)UV_ENOMEM, 0);
        return NULL;
    }
    loop.data = &run;

    uv_pipe_t child_stdin, child_stdout, child_stderr;
    uv_pipe_init(&loop, &child_stdin, 0);
    uv_pipe_init(&loop, &child_stdout, 0);
    uv_pipe_init(&loop, &child_stderr, 0);
    child_stdout.data = &run.out;
    child_stderr.data = &run.err;

    NtsView *input_view = (NtsView *)input;
    size_t input_length = input_view == NULL ? 0 : (size_t)nts_view_length(input_view);

    uv_stdio_container_t stdio[3];
    stdio[0].flags = input_view == NULL
        ? UV_IGNORE
        : (uv_stdio_flags)(UV_CREATE_PIPE | UV_READABLE_PIPE);
    stdio[0].data.stream = (uv_stream_t *)&child_stdin;
    stdio[1].flags = (uv_stdio_flags)(UV_CREATE_PIPE | UV_WRITABLE_PIPE);
    stdio[1].data.stream = (uv_stream_t *)&child_stdout;
    stdio[2].flags = (uv_stdio_flags)(UV_CREATE_PIPE | UV_WRITABLE_PIPE);
    stdio[2].data.stream = (uv_stream_t *)&child_stderr;

    size_t arg_count = 0, env_count = 0;
    char **argv = vector_of((NtsArray *)args, &arg_count);
    char **envp = env == NULL ? NULL : vector_of((NtsArray *)env, &env_count);
    char *path = cstring(file);
    char *directory = cstring(cwd);

    uv_process_options_t options;
    memset(&options, 0, sizeof(options));
    options.exit_cb = on_sync_exit;
    options.file = path;
    options.args = argv;
    options.env = envp;
    options.cwd = (directory != NULL && directory[0] != '\0') ? directory : NULL;
    options.stdio_count = 3;
    options.stdio = stdio;

    run.process.data = &run;
    int started = uv_spawn(&loop, &run.process, &options);
    double pid = 0;

    if (started != 0) {
        /* The handles were initialised on this loop and must be closed on it, or
         * `uv_loop_close` answers EBUSY and the loop leaks. */
        uv_close((uv_handle_t *)&child_stdin, NULL);
        uv_close((uv_handle_t *)&child_stdout, NULL);
        uv_close((uv_handle_t *)&child_stderr, NULL);
        uv_run(&loop, UV_RUN_DEFAULT);
        uv_loop_close(&loop);
        call_result(callback, -1, 0, bytes_view(NULL, 0), bytes_view(NULL, 0),
                    (double)started, 0);
    } else {
        pid = (double)run.process.pid;
        uv_timer_init(&loop, &run.timer);
        run.timer.data = &run;
        if (timeout_ms > 0) uv_timer_start(&run.timer, on_timeout, (uint64_t)timeout_ms, 0);
        else uv_close((uv_handle_t *)&run.timer, NULL);

        if (input_view != NULL) {
            uv_write_t *request = calloc(1, sizeof(uv_write_t));
            uv_buf_t buffer = uv_buf_init((char *)nts_view_bytes(input_view),
                                          (unsigned int)input_length);
            if (request == NULL || uv_write(request, (uv_stream_t *)&child_stdin,
                                            &buffer, 1, on_write) != 0) {
                free(request);
                uv_close((uv_handle_t *)&child_stdin, NULL);
            }
        } else {
            uv_close((uv_handle_t *)&child_stdin, NULL);
        }

        uv_read_start((uv_stream_t *)&child_stdout, on_alloc, on_read);
        uv_read_start((uv_stream_t *)&child_stderr, on_alloc, on_read);
        uv_run(&loop, UV_RUN_DEFAULT);
        uv_loop_close(&loop);

        int error = 0;
        if (run.timed_out) error = UV_ETIMEDOUT;
        else if (run.out.overflowed || run.err.overflowed) error = UV_ENOBUFS;

        call_result(callback, (double)run.status, (double)run.signal,
                    bytes_view(run.out.bytes, run.out.length),
                    bytes_view(run.err.bytes, run.err.length), (double)error, pid);
    }

    free(run.out.bytes);
    free(run.err.bytes);
    free(path);
    free(directory);
    free_vector(argv, arg_count);
    free_vector(envp, env_count);
    return NULL;
}


/* ============================================================ asynchronous */

/* A live child, on the **default** loop rather than a private one.
 *
 * The synchronous family above runs its own loop and closes it, because it must
 * not pump anything else. This half is the opposite: the child outlives the call
 * that made it, its output arrives while other work runs, and its `exit` has to
 * interleave with timers and sockets the way node's does. That is the default
 * loop by definition.
 */
typedef struct {
    bool used;
    uv_process_t process;
    uv_pipe_t in, out, err;
    bool has_in, has_out, has_err;
    bool in_closed;
    NtsHeader *on_exit;
    NtsHeader *on_error;
    NtsHeader *on_out_data, *on_out_end;
    NtsHeader *on_err_data, *on_err_end;
    int pid;
    bool exited;
} Child;

#define NTS_CP_MAX 256
static Child children[NTS_CP_MAX];

static Child *child_at(double handle) {
    if (handle != handle || handle < 0 || handle >= (double)NTS_CP_MAX) return NULL;
    Child *child = &children[(int)handle];
    return child->used ? child : NULL;
}

static double child_claim(void) {
    for (int index = 0; index < NTS_CP_MAX; index++) {
        if (!children[index].used) {
            memset(&children[index], 0, sizeof(Child));
            children[index].used = true;
            return (double)index;
        }
    }
    return (double)UV_EMFILE;
}

static void call_exit(NtsHeader *callback, double status, double signal) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, double))
         callback->descriptor->methods[nts_closure_call_slot])(callback, status, signal);
}

static void call_data(NtsHeader *callback, NtsView *bytes) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, NtsView *))
         callback->descriptor->methods[nts_closure_call_slot])(callback, bytes);
}

static void call_void(NtsHeader *callback) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *))
         callback->descriptor->methods[nts_closure_call_slot])(callback);
}

static void on_child_exit(uv_process_t *process, int64_t status, int signal) {
    Child *child = (Child *)process->data;
    if (child == NULL) return;
    child->exited = true;
    /* Node reports a signalled child as status null and signal named; the
     * TypeScript does that translation, so both numbers go up as they are. */
    call_exit(child->on_exit, (double)status, (double)signal);
}

static void on_child_alloc(uv_handle_t *handle, size_t suggested, uv_buf_t *buffer) {
    (void)handle;
    buffer->base = malloc(suggested);
    buffer->len = buffer->base == NULL ? 0 : suggested;
}

static void on_child_read(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
    Child *child = (Child *)stream->loop->data;
    bool is_out = (uv_pipe_t *)stream == (child == NULL ? NULL : &child->out);
    (void)is_out;
    /* `stream->data` carries the child; which pipe is decided by pointer. */
    child = (Child *)stream->data;
    if (child == NULL) { free(buffer->base); return; }
    const bool out = (uv_pipe_t *)stream == &child->out;
    if (count == UV_EOF) {
        free(buffer->base);
        call_void(out ? child->on_out_end : child->on_err_end);
        uv_read_stop(stream);
        return;
    }
    if (count < 0) { free(buffer->base); return; }
    NtsView *view = bytes_view(buffer->base, (size_t)count);
    free(buffer->base);
    if (view != NULL) call_data(out ? child->on_out_data : child->on_err_data, view);
}

static void on_child_write(uv_write_t *request, int status) {
    NtsHeader *callback = (NtsHeader *)request->data;
    call_exit(callback, (double)status, 0);
    free(request);
}

double nts_child_process_spawn(const NtsString *file, NtsHeader *args,
                               NtsHeader *env, const NtsString *cwd,
                               double stdio_mode, double detached,
                               double uid, double gid,
                               NtsHeader *on_exit, NtsHeader *on_error) {
    (void)on_error;
    const double claimed = child_claim();
    if (claimed < 0) return claimed;
    Child *child = &children[(int)claimed];
    child->on_exit = on_exit;

    uv_loop_t *loop = uv_default_loop();
    const int mode_in = ((int)stdio_mode) & 3;
    const int mode_out = (((int)stdio_mode) >> 2) & 3;
    const int mode_err = (((int)stdio_mode) >> 4) & 3;

    uv_stdio_container_t stdio[3];
    memset(stdio, 0, sizeof(stdio));
    struct { int mode; uv_pipe_t *pipe; bool *flag; int readable; } slots[3] = {
        { mode_in, &child->in, &child->has_in, 1 },
        { mode_out, &child->out, &child->has_out, 0 },
        { mode_err, &child->err, &child->has_err, 0 },
    };
    for (int index = 0; index < 3; index++) {
        if (slots[index].mode == 1) {
            stdio[index].flags = UV_INHERIT_FD;
            stdio[index].data.fd = index;
        } else if (slots[index].mode == 2) {
            stdio[index].flags = UV_IGNORE;
        } else {
            uv_pipe_init(loop, slots[index].pipe, 0);
            slots[index].pipe->data = child;
            *slots[index].flag = true;
            stdio[index].flags = (uv_stdio_flags)(UV_CREATE_PIPE |
                (slots[index].readable ? UV_READABLE_PIPE : UV_WRITABLE_PIPE));
            stdio[index].data.stream = (uv_stream_t *)slots[index].pipe;
        }
    }

    size_t arg_count = 0, env_count = 0;
    char **argv = vector_of((NtsArray *)args, &arg_count);
    char **envp = env == NULL ? NULL : vector_of((NtsArray *)env, &env_count);
    char *path = cstring(file);
    char *directory = cstring(cwd);

    uv_process_options_t options;
    memset(&options, 0, sizeof(options));
    options.exit_cb = on_child_exit;
    options.file = path;
    options.args = argv;
    options.env = envp;
    options.cwd = (directory != NULL && directory[0] != '\0') ? directory : NULL;
    options.stdio_count = 3;
    options.stdio = stdio;
    if (detached != 0) options.flags |= UV_PROCESS_DETACHED;
    /* libuv applies these after the fork and before the exec, and reports a
     * failure through uv_spawn's return -- which is how a non-root caller asking
     * for uid 0 becomes EPERM rather than a child running as itself. */
    if (uid >= 0) {
        options.uid = (uv_uid_t)uid;
        options.flags |= UV_PROCESS_SETUID;
    }
    if (gid >= 0) {
        options.gid = (uv_gid_t)gid;
        options.flags |= UV_PROCESS_SETGID;
    }

    child->process.data = child;
    const int started = uv_spawn(loop, &child->process, &options);

    free(path);
    free(directory);
    free_vector(argv, arg_count);
    free_vector(envp, env_count);

    if (started != 0) {
        if (child->has_in) uv_close((uv_handle_t *)&child->in, NULL);
        if (child->has_out) uv_close((uv_handle_t *)&child->out, NULL);
        if (child->has_err) uv_close((uv_handle_t *)&child->err, NULL);
        child->used = false;
        return (double)started;
    }
    child->pid = child->process.pid;
    return claimed;
}

void nts_child_process_read_start(double handle, double which,
                                  NtsHeader *on_data, NtsHeader *on_end) {
    Child *child = child_at(handle);
    if (child == NULL) return;
    const bool out = which == 1;
    if (out) { child->on_out_data = on_data; child->on_out_end = on_end; }
    else { child->on_err_data = on_data; child->on_err_end = on_end; }
    uv_pipe_t *pipe = out ? &child->out : &child->err;
    if (!(out ? child->has_out : child->has_err)) return;
    uv_read_start((uv_stream_t *)pipe, on_child_alloc, on_child_read);
}

double nts_child_process_write(double handle, NtsView *bytes, NtsHeader *callback) {
    Child *child = child_at(handle);
    if (child == NULL || !child->has_in || child->in_closed) return (double)UV_EPIPE;
    uv_write_t *request = calloc(1, sizeof(uv_write_t));
    if (request == NULL) return (double)UV_ENOMEM;
    request->data = callback;
    uv_buf_t buffer = uv_buf_init((char *)nts_view_bytes(bytes),
                                  (unsigned int)nts_view_length(bytes));
    const int status = uv_write(request, (uv_stream_t *)&child->in, &buffer, 1, on_child_write);
    if (status != 0) { free(request); return (double)status; }
    return 0;
}

void nts_child_process_end_stdin(double handle) {
    Child *child = child_at(handle);
    if (child == NULL || !child->has_in || child->in_closed) return;
    child->in_closed = true;
    uv_close((uv_handle_t *)&child->in, NULL);
}

double nts_child_process_kill(double handle, double signal) {
    Child *child = child_at(handle);
    if (child == NULL) return (double)UV_ESRCH;
    if (child->exited) return (double)UV_ESRCH;
    return (double)uv_process_kill(&child->process, (int)signal);
}

double nts_child_process_pid(double handle) {
    Child *child = child_at(handle);
    return child == NULL ? 0 : (double)child->pid;
}

void nts_child_process_close(double handle) {
    Child *child = child_at(handle);
    if (child == NULL) return;
    if (child->has_in && !child->in_closed) uv_close((uv_handle_t *)&child->in, NULL);
    if (child->has_out) uv_close((uv_handle_t *)&child->out, NULL);
    if (child->has_err) uv_close((uv_handle_t *)&child->err, NULL);
    uv_close((uv_handle_t *)&child->process, NULL);
    child->used = false;
}
