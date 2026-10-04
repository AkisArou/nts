public final class Drive {
    public static void main(String[] args) {
        nts.gen.Program.module$init();
        if (args.length > 0) {
            double iterations = Double.parseDouble(args[0]);
            if (args.length > 1 && args[1].equals("plural")) {
                boolean range = args.length > 2 && args[2].equals("range");
                nts.gen.Program.benchmarkPlural(50000, range);
                long from = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkPlural(iterations, range);
                long elapsed = System.nanoTime() - from;
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"plural-" + (range ? "range" : "scalar") + "\",\"nsPerSelect\":" + elapsed / iterations + ",\"checksum\":" + checksum + "}");
                return;
            }
            if (args.length > 1) {
                double count = Double.parseDouble(args[1]);
                nts.gen.Program.benchmarkList(10000, count);
                long from = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkList(iterations, count);
                long elapsed = System.nanoTime() - from;
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"list-assembly\",\"items\":" + count + ",\"nsPerFormat\":" + elapsed / iterations + ",\"checksum\":" + checksum + "}");
                return;
            }
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
