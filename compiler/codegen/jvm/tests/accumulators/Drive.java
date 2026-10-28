import nts.gen.Program;

public final class Drive {
    private static void report(double value) {
        if (Double.isNaN(value)) System.out.println("nan");
        else System.out.printf("%016x%n", Double.doubleToRawLongBits(value));
    }
    public static void main(String[] args) {
        double[] indices = { Double.NaN, Double.NEGATIVE_INFINITY, -1.9, -0.0,
            0, 0.9, 1, 2, 3, 4, 66, Double.POSITIVE_INFINITY };
        for (int n : new int[] { 0, 1, 2, 17 }) {
            report(Program.unitsUnchecked(n));
            report(Program.unitsDuringAppend(n));
            report(Program.unitAfterAppend(n));
            for (double index : indices) report(Program.unitsChecked(n, index));
        }
    }
}
