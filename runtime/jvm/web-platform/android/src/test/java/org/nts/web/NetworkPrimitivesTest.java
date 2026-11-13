package org.nts.web;

import java.io.FileInputStream;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Delayed;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.TrustManagerFactory;

/** Actual sockets and TLS. Runs without Android SDK; Android factory is a separate SDK gate. */
public final class NetworkPrimitivesTest {
    // A wedged fixture is an instrument failure. Readiness and supplied
    // scheduler events, rather than a real short window, decide the checks.
    private static final int HANG_MS = 5 * 60 * 1000;
    private static int tests;
    private static final List<String> errors = Collections.synchronizedList(new ArrayList<String>());
    private static final ExecutorService lane = Executors.newSingleThreadExecutor(r -> new Thread(r, "nts-runtime-test"));
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void callbackThread() { check(Thread.currentThread().getName().equals("nts-runtime-test"), "Callback escaped runtime lane"); }
    private static <T> T await(CompletableFuture<T> future) throws Exception {
        try { return future.get(HANG_MS, TimeUnit.MILLISECONDS); }
        catch (java.util.concurrent.TimeoutException error) {
            throw new AssertionError("INSTRUMENT: Java fixture completion exceeded its five-minute hang guard", error);
        }
    }
    private static final class Tick extends FutureTask<Void> implements ScheduledFuture<Void> {
        final long milliseconds;
        Tick(Runnable task, long milliseconds) { super(task, null); this.milliseconds = milliseconds; }
        public long getDelay(TimeUnit unit) { return unit.convert(milliseconds, TimeUnit.MILLISECONDS); }
        public int compareTo(Delayed other) { return Long.compare(getDelay(TimeUnit.MILLISECONDS), other.getDelay(TimeUnit.MILLISECONDS)); }
    }
    /** No worker or elapsed clock: only the test may deliver a scheduled task. */
    private static final class SuppliedClock extends ScheduledThreadPoolExecutor {
        private final List<Tick> tasks = new ArrayList<Tick>();
        SuppliedClock() { super(1); }
        @Override public synchronized ScheduledFuture<?> schedule(Runnable task, long delay, TimeUnit unit) {
            Tick tick = new Tick(task, unit.toMillis(delay)); tasks.add(tick); return tick;
        }
        synchronized Tick fire(long milliseconds) {
            check(!tasks.isEmpty(), "No scheduled observation to supply");
            Tick tick = tasks.remove(0);
            check(tick.milliseconds == milliseconds, "Scheduled delay changed");
            tick.run(); return tick;
        }
    }
    private static void passed(String name) { tests++; System.out.println("ok " + tests + " - " + name); }
    private static NetworkPrimitives primitives(int capacity) { return new NetworkPrimitives(lane, host -> true, (name,msg) -> errors.add(name+": "+msg), capacity); }
    private static CompletableFuture<Integer> connect(NetworkPrimitives api, String host, int port, boolean secure, int timeout) {
        CompletableFuture<Integer> future = new CompletableFuture<>();
        api.connect(host, port, secure, timeout, new NetworkPrimitives.ConnectCallback() {
            public void success(int handle) { callbackThread(); future.complete(handle); }
            public void failure(String name, String message) { callbackThread(); future.completeExceptionally(new IOException(name + ": " + message)); }
        }); return future;
    }
    private static CompletableFuture<byte[]> read(NetworkPrimitives api, int id) {
        CompletableFuture<byte[]> result = new CompletableFuture<>();
        api.read(id, 65536, new NetworkPrimitives.ReadCallback() {
            public void success(byte[] bytes, boolean eof) { callbackThread(); result.complete(eof ? null : bytes); }
            public void failure(String name, String message) { callbackThread(); result.completeExceptionally(new IOException(name+": "+message)); }
        }); return result;
    }
    private static CompletableFuture<Integer> write(NetworkPrimitives api, int id, byte[] bytes) {
        CompletableFuture<Integer> result = new CompletableFuture<>();
        api.write(id, bytes, 0, bytes.length, new NetworkPrimitives.WriteCallback() {
            public void success(int count) { callbackThread(); result.complete(count); }
            public void failure(String name, String message) { callbackThread(); result.completeExceptionally(new IOException(name+": "+message)); }
        }); return result;
    }
    private static void fails(CompletableFuture<?> future, String expected) throws Exception {
        try { await(future); throw new AssertionError("Expected failure: " + expected); }
        catch (java.util.concurrent.ExecutionException error) { check(error.getCause().toString().toLowerCase().contains(expected.toLowerCase()), error.toString()); }
    }
    public static void main(String[] args) throws Exception {
        try {
            tcp(); cancellation(); policies(); timers(); tls(args[0]);
            check(errors.isEmpty(), "Reported callback errors: " + errors);
            System.out.println("PASS: " + tests + " Java integration tests");
        } finally {
            lane.shutdownNow();
            check(lane.awaitTermination(HANG_MS, TimeUnit.MILLISECONDS), "INSTRUMENT: runtime lane did not close within its hang guard");
        }
    }
    private static void tcp() throws Exception {
        try (ServerSocket server = new ServerSocket(0); NetworkPrimitives api = primitives(2)) {
            CompletableFuture<Socket> accepted = new CompletableFuture<>();
            Thread peer = new Thread(() -> { try { accepted.complete(server.accept()); } catch (IOException e) { accepted.completeExceptionally(e); } }); peer.start();
            int id = await(connect(api, "127.0.0.1", server.getLocalPort(), false, HANG_MS));
            try (Socket remote = await(accepted)) {
                remote.setSoTimeout(HANG_MS);
                byte[] payload = "hello world".getBytes(StandardCharsets.UTF_8);
                check(await(write(api,id,payload)) == payload.length, "Partial write accounting");
                byte[] bytes = new byte[payload.length]; int offset=0;
                while (offset < bytes.length) offset += remote.getInputStream().read(bytes,offset,bytes.length-offset);
                check(Arrays.equals(bytes,payload), "Wire bytes");
                // Exercise rapid callback -> read -> callback reuse with a pool capacity of two.
                for (int i=0;i<200;i++) { remote.getOutputStream().write(i); byte[] response=await(read(api,id));check(response.length==1 && (response[0]&255)==(i&255),"Read byte"); }
                remote.shutdownOutput(); check(await(read(api,id)) == null,"EOF");
                api.closeSocket(id); check(api.openSocketCount()==0,"Close reclaimed socket");
            } peer.join(); passed("TCP bytes, EOF, callback lane and repeated read/write scheduling");
        }
    }
    private static void cancellation() throws Exception {
        try (ServerSocket server=new ServerSocket(0); NetworkPrimitives api=primitives(1)) {
            CompletableFuture<Socket> accepted=new CompletableFuture<>();
            new Thread(()->{try{accepted.complete(server.accept());}catch(IOException e){accepted.completeExceptionally(e);}}).start();
            int id=await(connect(api,"127.0.0.1",server.getLocalPort(),false,HANG_MS));
            try(Socket remote=await(accepted)) {
                check(remote.isConnected(),"Accepted socket");
                CompletableFuture<byte[]> pending=read(api,id);
                await(laneSubmit(()->{}));
                await(failureNameForSecondRead(api,id));
                api.closeSocket(id);fails(pending,"socket");check(api.openSocketCount()==0,"Close interrupts blocked read");
                passed("Overlapping read rejection and close interrupting blocked I/O");
            }
        }
    }
    private static CompletableFuture<Void> failureNameForSecondRead(NetworkPrimitives api,int id){
        CompletableFuture<Void> f=new CompletableFuture<>();api.read(id,1,new NetworkPrimitives.ReadCallback(){
            public void success(byte[] bytes,boolean eof){f.completeExceptionally(new AssertionError("Overlapping read succeeded"));}
            public void failure(String name,String message){callbackThread();if(name.equals("IllegalStateException"))f.complete(null);else f.completeExceptionally(new AssertionError(name));}
        });return f;
    }
    private static CompletableFuture<Void> laneSubmit(Runnable runnable) { CompletableFuture<Void> f=new CompletableFuture<>();lane.execute(()->{runnable.run();f.complete(null);});return f; }
    private static void policies() throws Exception {
        try(NetworkPrimitives denied=new NetworkPrimitives(lane,host->false,(n,m)->errors.add(m),1)) {
            fails(connect(denied,"127.0.0.1",12345,false,HANG_MS),"Cleartext");check(denied.openSocketCount()==0,"Policy leak");passed("Android cleartext policy applied before network I/O");
        }
        try(NetworkPrimitives denied=new NetworkPrimitives(lane,host->{throw new IllegalStateException("policy failed");},(n,m)->errors.add(m),1)) {
            fails(connect(denied,"127.0.0.1",12345,false,HANG_MS),"policy failed");check(denied.openSocketCount()==0,"Throwing policy leak");passed("Throwing policy cannot leak connection capacity");
        }
        try(ServerSocket server=new ServerSocket(0);NetworkPrimitives api=primitives(1)) {
            int id=await(connect(api,"127.0.0.1",server.getLocalPort(),false,HANG_MS));
            try(Socket remote=server.accept()) {check(remote.isConnected(),"Accepted socket");fails(connect(api,"127.0.0.1",server.getLocalPort(),false,HANG_MS),"capacity");api.closeSocket(id);passed("Connection capacity enforcement");}
        }
        try(NetworkPrimitives api=primitives(1)) {byte[] a=new byte[32],b=new byte[32];api.randomFill(a);api.randomFill(b);check(!Arrays.equals(a,b),"Randomness unexpectedly repeated");passed("Platform secure randomness primitive smoke test");}
    }
    private static void timers() throws Exception {
        try(NetworkPrimitives api=primitives(1)) {
            CompletableFuture<Void> posted=new CompletableFuture<>();api.post(()->{callbackThread();posted.complete(null);});await(posted);
            CompletableFuture<Void> fired=new CompletableFuture<>();api.timer(5,()->{callbackThread();fired.complete(null);});await(fired);
        }
        SuppliedClock clock=new SuppliedClock();
        try(NetworkPrimitives api=new NetworkPrimitives(lane,h->true,(n,m)->errors.add(m),1,
                (javax.net.ssl.SSLSocketFactory)javax.net.ssl.SSLSocketFactory.getDefault(),clock)) {
            CompletableFuture<Void> fired=new CompletableFuture<>();
            api.timer(37,()->{callbackThread();fired.complete(null);});
            check(!fired.isDone(),"An undelivered timer fired");clock.fire(37);await(fired);
            CountDownLatch laneHeld=new CountDownLatch(1), release=new CountDownLatch(1);
            lane.execute(()->{laneHeld.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}});
            check(laneHeld.await(HANG_MS,TimeUnit.MILLISECONDS),"INSTRUMENT: runtime lane did not reach its barrier");
            try {
                AtomicInteger calls=new AtomicInteger();int timer=api.timer(0,calls::incrementAndGet);
                clock.fire(0);api.clearTimer(timer);release.countDown();await(laneSubmit(()->{}));
                check(calls.get()==0,"Canceled queued timer fired");
            } finally { release.countDown(); }
            AtomicInteger canceled=new AtomicInteger();int timer=api.timer(13,canceled::incrementAndGet);
            api.clearTimer(timer);check(clock.fire(13).isCancelled(),"Cancellation did not reach the scheduler");
            await(laneSubmit(()->{}));check(canceled.get()==0,"Canceled pending timer fired");
        } finally {
            check(!clock.isShutdown(),"A borrowed scheduler was shut down");clock.shutdownNow();
        }
        passed("Task lane, supplied timer firing and cancellation before and after expiry");
    }
    private static void tls(String keyStorePath) throws Exception {
        KeyStore store=KeyStore.getInstance("PKCS12");try(FileInputStream input=new FileInputStream(keyStorePath)){store.load(input,"test-only".toCharArray());}
        KeyManagerFactory keys=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());keys.init(store,"test-only".toCharArray());
        TrustManagerFactory trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());trust.init(store);
        SSLContext context=SSLContext.getInstance("TLS");context.init(keys.getKeyManagers(),trust.getTrustManagers(),null);
        SSLServerSocket server=(SSLServerSocket)context.getServerSocketFactory().createServerSocket(0);
        try(NetworkPrimitives trusted=new NetworkPrimitives(lane,h->true,(n,m)->errors.add(m),4,context.getSocketFactory());NetworkPrimitives untrusted=primitives(2)) {
            AtomicInteger remaining=new AtomicInteger(3);
            Thread peer=new Thread(()->{while(remaining.getAndDecrement()>0){try(Socket socket=server.accept()){socket.getOutputStream().write(42);}catch(IOException expected){/* Negative TLS tests abort the server handshake. */}}});peer.start();
            try {
                int id=await(connect(trusted,"127.0.0.1",server.getLocalPort(),true,HANG_MS));check(await(read(trusted,id))[0]==42,"TLS payload");trusted.closeSocket(id);passed("TLS with private root and hostname verification");
                fails(connect(untrusted,"127.0.0.1",server.getLocalPort(),true,HANG_MS),"SSLHandshakeException");passed("Untrusted TLS certificate rejected");
                fails(connect(trusted,"localhost",server.getLocalPort(),true,HANG_MS),"SSLHandshakeException");passed("Trusted certificate with wrong hostname rejected");
            } finally {
                server.close();peer.join(HANG_MS);check(!peer.isAlive(),"INSTRUMENT: TLS peer did not close within its hang guard");
            }
        } finally { server.close(); }
        SuppliedClock clock=new SuppliedClock();
        ServerSocket stalled=new ServerSocket(0);
        try(NetworkPrimitives api=new NetworkPrimitives(lane,h->true,(n,m)->errors.add(m),1,context.getSocketFactory(),clock)) {
            CompletableFuture<Socket> accepted=new CompletableFuture<>();
            Thread peer=new Thread(()->{try{accepted.complete(stalled.accept());}catch(IOException error){accepted.completeExceptionally(error);}});
            peer.start();
            CompletableFuture<Integer> connected=connect(api,"127.0.0.1",stalled.getLocalPort(),true,HANG_MS);
            try(Socket remote=await(accepted)) {
                check(remote.isConnected(),"Stalled peer accepted the socket");
                clock.fire(HANG_MS);fails(connected,"SocketTimeoutException");
                check(api.openSocketCount()==0,"TLS timeout leak");
            } finally {
                stalled.close();peer.join(HANG_MS);check(!peer.isAlive(),"INSTRUMENT: stalled peer did not close within its hang guard");
            }
            passed("Supplied TLS deadline closes a stalled handshake and releases capacity");
        } finally {
            stalled.close();
            check(!clock.isShutdown(),"A borrowed deadline scheduler was shut down");clock.shutdownNow();
        }
    }
}
