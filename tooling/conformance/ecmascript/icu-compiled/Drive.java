public final class Drive {
    public static void main(String[] args) {
        nts.gen.Program.module$init();
        if (args.length > 0) {
            double iterations = Double.parseDouble(args[0]);
            if (args.length > 1 && args[1].equals("zoned-time")) {
                boolean ambiguous = args.length > 2 && args[2].equals("ambiguous");
                nts.gen.Program.benchmarkZonedTime(50000, ambiguous);
                long before = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkZonedTime(iterations, ambiguous);
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"zoned-time\",\"ambiguous\":" + ambiguous + ",\"checksum\":" + checksum + ",\"nsPerResolution\":" + (System.nanoTime() - before) / iterations + "}");
                return;
            }
            if (args.length > 1 && args[1].equals("locale")) {
                boolean cached = args.length > 2 && args[2].equals("cached");
                nts.gen.Program.benchmarkLocale(cached ? 50000 : 1000, cached);
                long before = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkLocale(iterations, cached);
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"locale-preferences\",\"cached\":" + cached + ",\"checksum\":" + checksum + ",\"nsPerQuerySet\":" + (System.nanoTime() - before) / iterations + "}");
                return;
            }
            if (args.length > 1 && args[1].equals("segment")) {
                boolean containing = args.length > 2 && args[2].equals("containing");
                boolean wide = args.length > 3 && args[3].equals("wide");
                nts.gen.Program.benchmarkSegment(containing ? 50000 : 5000, containing, wide);
                long before = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkSegment(iterations, containing, wide);
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"segment-" + (containing ? "containing" : "iterate") + "\",\"text\":\"" + (wide ? "wide" : "latin1") + "\",\"checksum\":" + checksum + ",\"nsPerOperation\":"
                    + (System.nanoTime() - before) / iterations + "}");
                return;
            }
            if (args.length > 1 && args[1].equals("display")) {
                boolean fields = args.length > 2 && args[2].equals("fields");
                nts.gen.Program.benchmarkDisplay(50000, fields);
                long before = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkDisplay(iterations, fields);
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"display-names\",\"type\":\"" + (fields ? "fields" : "currency") + "\",\"checksum\":" + checksum + ",\"nsPerCall\":"
                    + (System.nanoTime() - before) / iterations + "}");
                return;
            }
            if (args.length > 1 && args[1].equals("supported")) {
                boolean timeZones = args.length > 2 && args[2].equals("timeZone");
                nts.gen.Program.benchmarkSupported(10000, timeZones);
                long from = System.nanoTime();
                double checksum = nts.gen.Program.benchmarkSupported(iterations, timeZones);
                long elapsed = System.nanoTime() - from;
                System.out.println("{\"backend\":\"jvm\",\"mode\":\"supported-values\",\"key\":\"" + (timeZones ? "timeZone" : "numberingSystem") + "\",\"nsPerCall\":" + elapsed / iterations + ",\"checksum\":" + checksum + "}");
                return;
            }
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
