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
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.TrustManagerFactory;

/** Actual sockets and TLS. Runs without Android SDK; Android factory is a separate SDK gate. */
public final class NetworkPrimitivesTest {
    private static int tests;
    private static final List<String> errors = Collections.synchronizedList(new ArrayList<String>());
    private static final ExecutorService lane = Executors.newSingleThreadExecutor(r -> new Thread(r, "nts-runtime-test"));
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void callbackThread() { check(Thread.currentThread().getName().equals("nts-runtime-test"), "Callback escaped runtime lane"); }
    private static <T> T await(CompletableFuture<T> future) throws Exception { return future.get(5, TimeUnit.SECONDS); }
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
        } finally { lane.shutdownNow(); lane.awaitTermination(5, TimeUnit.SECONDS); }
    }
    private static void tcp() throws Exception {
        try (ServerSocket server = new ServerSocket(0); NetworkPrimitives api = primitives(2)) {
            CompletableFuture<Socket> accepted = new CompletableFuture<>();
            Thread peer = new Thread(() -> { try { accepted.complete(server.accept()); } catch (IOException e) { accepted.completeExceptionally(e); } }); peer.start();
            int id = await(connect(api, "127.0.0.1", server.getLocalPort(), false, 1000));
            try (Socket remote = await(accepted)) {
                remote.setSoTimeout(3000);
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
            int id=await(connect(api,"127.0.0.1",server.getLocalPort(),false,1000));
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
            fails(connect(denied,"127.0.0.1",12345,false,1000),"Cleartext");check(denied.openSocketCount()==0,"Policy leak");passed("Android cleartext policy applied before network I/O");
        }
        try(NetworkPrimitives denied=new NetworkPrimitives(lane,host->{throw new IllegalStateException("policy failed");},(n,m)->errors.add(m),1)) {
            fails(connect(denied,"127.0.0.1",12345,false,1000),"policy failed");check(denied.openSocketCount()==0,"Throwing policy leak");passed("Throwing policy cannot leak connection capacity");
        }
        try(ServerSocket server=new ServerSocket(0);NetworkPrimitives api=primitives(1)) {
            int id=await(connect(api,"127.0.0.1",server.getLocalPort(),false,1000));
            try(Socket remote=server.accept()) {check(remote.isConnected(),"Accepted socket");fails(connect(api,"127.0.0.1",server.getLocalPort(),false,1000),"capacity");api.closeSocket(id);passed("Connection capacity enforcement");}
        }
        try(NetworkPrimitives api=primitives(1)) {byte[] a=new byte[32],b=new byte[32];api.randomFill(a);api.randomFill(b);check(!Arrays.equals(a,b),"Randomness unexpectedly repeated");passed("Platform secure randomness primitive smoke test");}
    }
    private static void timers() throws Exception {
        try(NetworkPrimitives api=primitives(1)) {
            CompletableFuture<Void> posted=new CompletableFuture<>();api.post(()->{callbackThread();posted.complete(null);});await(posted);
            CompletableFuture<Void> fired=new CompletableFuture<>();api.timer(5,()->{callbackThread();fired.complete(null);});await(fired);
            CountDownLatch laneHeld=new CountDownLatch(1), release=new CountDownLatch(1);lane.execute(()->{laneHeld.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}});laneHeld.await();
            AtomicInteger calls=new AtomicInteger();int timer=api.timer(0,calls::incrementAndGet);Thread.sleep(30);api.clearTimer(timer);release.countDown();await(laneSubmit(()->{}));check(calls.get()==0,"Canceled queued timer fired");passed("Task lane, timer firing and cancellation after expiry before delivery");
        }
    }
    private static void tls(String keyStorePath) throws Exception {
        KeyStore store=KeyStore.getInstance("PKCS12");try(FileInputStream input=new FileInputStream(keyStorePath)){store.load(input,"test-only".toCharArray());}
        KeyManagerFactory keys=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());keys.init(store,"test-only".toCharArray());
        TrustManagerFactory trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());trust.init(store);
        SSLContext context=SSLContext.getInstance("TLS");context.init(keys.getKeyManagers(),trust.getTrustManagers(),null);
        try(SSLServerSocket server=(SSLServerSocket)context.getServerSocketFactory().createServerSocket(0);
            NetworkPrimitives trusted=new NetworkPrimitives(lane,h->true,(n,m)->errors.add(m),4,context.getSocketFactory());NetworkPrimitives untrusted=primitives(2)) {
            AtomicInteger remaining=new AtomicInteger(3);
            Thread peer=new Thread(()->{while(remaining.getAndDecrement()>0){try(Socket socket=server.accept()){socket.getOutputStream().write(42);}catch(IOException expected){/* Negative TLS tests abort the server handshake. */}}});peer.start();
            int id=await(connect(trusted,"127.0.0.1",server.getLocalPort(),true,2000));check(await(read(trusted,id))[0]==42,"TLS payload");trusted.closeSocket(id);passed("TLS with private root and hostname verification");
            fails(connect(untrusted,"127.0.0.1",server.getLocalPort(),true,2000),"SSLHandshakeException");passed("Untrusted TLS certificate rejected");
            fails(connect(trusted,"localhost",server.getLocalPort(),true,2000),"SSLHandshakeException");passed("Trusted certificate with wrong hostname rejected");peer.join(3000);check(!peer.isAlive(),"Peer thread leaked");
        }
        try(ServerSocket stalled=new ServerSocket(0);NetworkPrimitives api=primitives(1)) {
            fails(connect(api,"127.0.0.1",stalled.getLocalPort(),true,50),"SocketTimeoutException");check(api.openSocketCount()==0,"TLS timeout leak");passed("Stalled TLS handshake times out and releases capacity");
        }
    }
}
