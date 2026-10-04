public final class CalendarDrive {
    public static void main(String[] args) {
        nts.gen.Program.module$init();
        for (CalendarCases.Case sample : CalendarCases.CASES) {
            String text = nts.gen.Program.snapshot(sample.calendar, sample.day);
            if (!text.equals(sample.expected))
                throw new AssertionError(sample.calendar + ": " + text + " != " + sample.expected);
            System.out.println(text);
        }
        for (String id : CalendarCases.IDS) {
            double ordinary = nts.gen.Program.roundTrips(id, -25567, 55000, 1);
            boolean hebrew = id.equals("hebrew");
            boolean arithmetic = !hebrew && !id.equals("chinese") && !id.equals("dangi")
                && !id.equals("persian") && !id.equals("islamic-umalqura");
            if (hebrew && nts.gen.Program.hebrewProviderAgreement(-25567, 55000) != 55000)
                throw new AssertionError("Hebrew arithmetic differs from public ICU fields");
            if (arithmetic && nts.gen.Program.arithmeticProviderAgreement(id, -25567, 55000) != 55000)
                throw new AssertionError(id + " arithmetic differs from public ICU fields");
            double extended = hebrew
                ? nts.gen.Program.hebrewRoundTrips(-100000000, 1001, 200000)
                : arithmetic ? nts.gen.Program.arithmeticRoundTrips(id, -100000000, 1001, 200000)
                : nts.gen.Program.roundTrips(id, -100000000, 1001, 200000);
            if (!Double.isFinite(ordinary) || ordinary < 55000 || ordinary > 55000 * 500
                    || !Double.isFinite(extended) || extended < -1001 || extended > 1001 * 500
                    || !nts.gen.Program.invalidDate(id)) throw new AssertionError(id);
            System.out.println(id + ":roundtrips:55000:invalid:true:extended:" + (extended < 0 ? (int) extended : 0));
        }
        for (CalendarCases.Case sample : CalendarCases.TABLE_CASES) {
            String text = nts.gen.Program.tableSnapshot(sample.calendar, sample.day);
            if (!text.equals(sample.expected)) throw new AssertionError(text);
            System.out.println(text);
        }
        for (String id : new String[] {"chinese", "dangi"}) {
            double count = nts.gen.Program.tableRoundTrips(id);
            if (count != (id.equals("chinese") ? 73442 : 55193)) throw new AssertionError(id);
            System.out.println(id + ":table-roundtrips:" + (int) count);
        }
    }
}
