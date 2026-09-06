package org.nts.web;

import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.CookieJar;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * The production Android dispatcher, built on a pinned OkHttp.
 *
 * <h2>What this class is mostly for is turning things off</h2>
 *
 * OkHttp is a very good HTTP client, and every one of the things it does well
 * is a thing the shared TypeScript already does and must keep doing. Redirects,
 * cookies, caching, retries and content decoding are **observable Fetch
 * behaviour**: which redirects are followed, what a `Response` reports as its
 * `url`, whether `Content-Encoding` is still on the response a program reads.
 * If OkHttp does any of it, the answer depends on which provider a program is
 * running under, and the provider stops being an implementation detail.
 *
 * <p>So the configuration is the feature, and each line has a reason:
 *
 * <ul>
 * <li>`followRedirects(false)` / `followSslRedirects(false)` -- the redirect
 *     mode, the count, and the URL the response reports are the shared
 *     implementation's, and a redirect followed here is one it never sees.
 * <li>`cookieJar(NO_COOKIES)` -- cookie storage and the rules for it belong to
 *     one implementation, not one per platform.
 * <li>`cache(null)` -- likewise for the HTTP cache, which is also where
 *     revalidation and `Vary` live.
 * <li>`retryOnConnectionFailure(false)` -- a retry that the shared code did not
 *     ask for is a request the program did not make.
 * </ul>
 *
 * <h2>Transparent decompression, which is the one that lies</h2>
 *
 * The others change *what happens*. This one changes what the response
 * **says**. OkHttp adds `Accept-Encoding: gzip` when the caller has not, and
 * when it added the header it also decompresses the body -- and then strips
 * `Content-Encoding` and `Content-Length`, because leaving them would describe
 * bytes it has already replaced.
 *
 * <p>That is correct of OkHttp and wrong for this: shared code that reads
 * `Content-Encoding` to decide whether to inflate sees a header that is gone,
 * and shared code that reads `Content-Length` sees a header that is gone too --
 * on Android only. The identical program on the raw transport sees both.
 *
 * <p>The fix is to always send the header **ourselves**. OkHttp's transparent
 * path engages only when it added the header, so an explicitly-set
 * `Accept-Encoding` -- even the same `gzip` -- leaves the body and the headers
 * exactly as the server sent them. The wire request is unchanged; the response
 * stops being rewritten.
 */
public final class OkHttpNetworking {
    private OkHttpNetworking() {}

    /** Status, headers as alternating name/value, and the body exactly as sent. */
    public interface ResponseCallback {
        void success(int status, String[] headers, byte[] body);
        void failure(String name, String message);
    }

    /**
     * A client that does none of the things the shared implementation does.
     *
     * <p>No `Dispatcher` executor is set: OkHttp's own threads run the request
     * and the completion is handed to `lane`, which is the owner lane. A
     * provider that called back on OkHttp's thread would be handing TypeScript
     * to a thread that does not own the environment.
     */
    public static OkHttpClient client() {
        return new OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES)
            .cache(null)
            .retryOnConnectionFailure(false)
            .build();
    }

    /**
     * Send a request. `headers` is alternating name/value.
     *
     * <p>Returns the `Call`, which is the cancellation handle: `cancel()` is
     * idempotent and safe from any thread, and a cancelled call still completes
     * -- through `onFailure` -- so nothing the caller reserved is stranded.
     */
    public static Call send(OkHttpClient client, final Executor lane, String method, String url,
                            String[] headers, byte[] body, final ResponseCallback callback) {
        Request.Builder request = new Request.Builder().url(url);
        boolean acceptEncoding = false;
        for (int i = 0; i + 1 < headers.length; i += 2) {
            request.addHeader(headers[i], headers[i + 1]);
            if ("accept-encoding".equalsIgnoreCase(headers[i])) { acceptEncoding = true; }
        }
        // See the class note. Setting it ourselves -- to whatever the shared
        // code would have got by default -- is what keeps OkHttp out of the
        // body and out of the headers that describe it.
        if (!acceptEncoding) { request.addHeader("Accept-Encoding", "gzip"); }
        RequestBody payload = body == null ? null : RequestBody.create(body, (MediaType) null);
        if (payload == null && requiresBody(method)) {
            payload = RequestBody.create(new byte[0], (MediaType) null);
        }
        request.method(method, payload);

        Call call = client.newCall(request.build());
        call.enqueue(new Callback() {
            @Override public void onFailure(Call call, IOException failure) {
                deliver(lane, callback, failure.getClass().getSimpleName(), text(failure));
            }
            @Override public void onResponse(Call call, Response response) {
                try {
                    ResponseBody content = response.body();
                    final byte[] bytes = content == null ? new byte[0] : content.bytes();
                    Headers received = response.headers();
                    final String[] flat = new String[received.size() * 2];
                    for (int i = 0; i < received.size(); i++) {
                        flat[i * 2] = received.name(i);
                        flat[i * 2 + 1] = received.value(i);
                    }
                    final int status = response.code();
                    submit(lane, new Runnable() {
                        @Override public void run() { callback.success(status, flat, bytes); }
                    }, callback);
                } catch (IOException | RuntimeException failure) {
                    deliver(lane, callback, failure.getClass().getSimpleName(), text(failure));
                } finally {
                    response.close();
                }
            }
        });
        return call;
    }

    private static boolean requiresBody(String method) {
        return "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
    }

    private static String text(Exception failure) {
        return failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
    }

    private static void deliver(Executor lane, final ResponseCallback callback,
                                final String name, final String message) {
        submit(lane, new Runnable() {
            @Override public void run() { callback.failure(name, message); }
        }, callback);
    }

    /**
     * A completion the owner lane refused is still a completion the caller is
     * waiting for, so it is reported rather than dropped -- on OkHttp's thread,
     * which is the only one left, and only because the alternative is a caller
     * that waits forever.
     */
    private static void submit(Executor lane, Runnable work, ResponseCallback callback) {
        try {
            lane.execute(work);
        } catch (RejectedExecutionException shuttingDown) {
            callback.failure("RejectedExecutionException",
                "the NTS runtime lane rejected a completion during shutdown");
        }
    }
}
