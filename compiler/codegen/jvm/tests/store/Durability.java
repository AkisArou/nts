import nts.rt.NtsStore;

/** One commit, so the shim in front of libc has exactly one thing to report. */
public final class Durability {
    public static void main(String[] args) throws Exception {
        NtsStore.configure(args[0]);
        long handle = NtsStore.open("ns", "k");
        byte[] payload = "payload".getBytes("UTF-8");
        NtsStore.append(handle, payload, 0, payload.length);
        NtsStore.commit(handle);
        System.exit(0);
    }
}
