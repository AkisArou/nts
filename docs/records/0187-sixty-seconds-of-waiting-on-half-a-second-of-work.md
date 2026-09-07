# Sixty seconds of waiting on half a second of work

The two-adapter HTTP corpus passed the first time I ran it. Eight cases, 65
checks, zero failures, and sixty-one seconds.

    java -Xverify:all -cp ... BothHttp
    0.48s user  0.07s system  0% cpu  1:00.25 total

Half a second of CPU inside a minute of wall clock. Nothing was computing; the
process was waiting to be allowed to exit.

OkHttp's dispatcher threads are not daemons and idle out after sixty seconds.
`main` had printed its result and returned, and the JVM sat holding the process
open for a thread pool with nothing left to run. The adapter had no shutdown at
all -- `client()` builds one and nothing ever takes it down.

That is a test being slow. It is also a production defect, and the plan says so
in a sentence I had read and implemented around: *"Shutdown first stops new
work, then cancels and settles platform operations, drains/drops their reserved
completions, closes pools and sessions, and only then releases the completion
executor/environment."* On a desktop the consequence is a slow suite. On Android
it is a process that will not finish and a connection pool holding sockets on a
network the device has already left.

    cancelAll  ->  executorService().shutdown()  ->  connectionPool().evictAll()

The order is the plan's and each step is load-bearing. `cancelAll` first,
because a cancelled call still completes -- through `onFailure` -- and that is
what returns the completion credit the caller reserved; cancelling after the
executor is down delivers those failures nowhere. The pool last, because its
connections are still serving until the cancellations land. The caller's own
lane is released *after* this returns, which is why `shutdown` does not touch
it: a lane closed first turns every cancellation into the
`RejectedExecutionException` path, which reports the right thing for the wrong
reason and would have looked fine.

    60.25s  ->  0.26s

## The sabotage that proved nothing, twice

The plan also names a specific sabotage: omit the adapter's explicit
`Accept-Encoding` and prove OkHttp's transparent decompression is detected. I
removed the line. The corpus stayed green.

The line is:

    if (!acceptEncoding) { request.addHeader("Accept-Encoding", "gzip"); }

and every gzip case in the corpus asked for gzip **from the caller**, so
`acceptEncoding` was true and the line never ran. Worse than a sabotage that
fails to bite: a sabotage on code the test never reaches, which reads as
evidence that the code does not matter.

It matters exactly once. OkHttp decompresses transparently and strips
`Content-Encoding` and `Content-Length` when *OkHttp itself* added the request
header -- not when the caller did. So the only case that can see the difference
is a gzip response requested with no `Accept-Encoding` at all, which is the case
nobody writes, because reading the adapter suggests the header is always there.

With that case present the sabotage fails three ways at once:

    FAIL content-encoding is gzip on the reference and null on OkHttp
    FAIL content-length is 62 on the reference and null on OkHttp
    FAIL the bodies differ -- 62 bytes against 52

62 encoded bytes arriving as 52 decoded ones, on the path that is supposed to
hand the shared layer exactly what the server sent.

## What both of these have in common

Neither is visible from one adapter. The sixty seconds was invisible because
`OkHttpHeadersTest` runs four cases and nobody times a four-case suite. The
transparent decode was invisible because a suite that drives OkHttp and asserts
what OkHttp does will agree with itself no matter what OkHttp does.

The rule, which is the same one record 0186 arrived at from the other side: a
test whose oracle is the thing under test is measuring its own expectations. The
reference transport is worth its cost precisely because it is a second opinion
that was written before the production one and cannot be quietly changed to
agree.
