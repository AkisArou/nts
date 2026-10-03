public final class Drive {
    public static void main(String[] args) {
        nts.gen.Program.module$init();
        if (args.length > 0) {
            double iterations = Double.parseDouble(args[0]);
            nts.gen.Program.benchmark(5000);
            long from = System.nanoTime();
            double checksum = nts.gen.Program.benchmark(iterations);
            long elapsed = System.nanoTime() - from;
            System.out.println("{\"backend\":\"jvm\",\"nsPerFormat\":" + elapsed / iterations + ",\"checksum\":" + checksum + "}");
            return;
        }
        System.out.println(nts.gen.Program.main());
    }
}
