public final class DurationDrive {
    public static void main(String[] args) {
        nts.gen.Program.module$init();
        if (args.length > 0) {
            double iterations = Double.parseDouble(args[0]);
            nts.gen.Program.benchmarkDuration(50000);
            java.lang.management.ThreadMXBean bean = java.lang.management.ManagementFactory.getThreadMXBean();
            com.sun.management.ThreadMXBean allocations = bean instanceof com.sun.management.ThreadMXBean ? (com.sun.management.ThreadMXBean) bean : null;
            boolean track = allocations != null && allocations.isThreadAllocatedMemorySupported();
            if (track && !allocations.isThreadAllocatedMemoryEnabled()) allocations.setThreadAllocatedMemoryEnabled(true);
            long thread = Thread.currentThread().getId();
            long bytes = track ? allocations.getThreadAllocatedBytes(thread) : 0;
            long start = System.nanoTime();
            double checksum = nts.gen.Program.benchmarkDuration(iterations);
            long elapsed = System.nanoTime() - start;
            String allocated = track ? Double.toString((allocations.getThreadAllocatedBytes(thread) - bytes) / iterations) : "null";
            System.out.println("{\"backend\":\"jvm\",\"mode\":\"duration-digital-text\",\"nsPerFormat\":" + elapsed / iterations + ",\"allocatedBytesPerFormat\":" + allocated + ",\"checksum\":" + checksum + "}");
            return;
        }
        System.out.println(nts.gen.Program.main());
    }
}
