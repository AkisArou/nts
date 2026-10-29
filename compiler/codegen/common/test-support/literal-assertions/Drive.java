import nts.gen.Program;
import nts.rt.NtsBigInt;
import nts.rt.NtsValue;

public class Drive {
    private static int cases;
    private static int failures;
    private static NtsValue box(Object value) {
        if (value == null) return NtsValue.NULL_VALUE;
        if (value instanceof NtsValue) return (NtsValue)value;
        if (value instanceof Double) return NtsValue.ofNumber((Double)value);
        if (value instanceof Boolean) return NtsValue.ofBoolean((Boolean)value);
        if (value instanceof String) return NtsValue.ofString((String)value);
        if (value instanceof NtsBigInt) return NtsValue.ofBigInt((NtsBigInt)value);
        throw new AssertionError("unmodelled caller value");
    }
    private static void expect(String name, double found, double wanted) {
        cases++;
        if (Double.doubleToLongBits(found) != Double.doubleToLongBits(wanted)) {
            System.err.println(name + ": " + found + ", expected " + wanted);
            failures++;
        }
    }
    public static void main(String[] args) {
        double[] inputs = {64, 63, 0, -0., 1, 2, 3, 7, 0.5, Double.NaN, Double.POSITIVE_INFINITY};
        for (double n : inputs) {
            expect("number", Program.numberClaim(box(n)), n == 64 ? 64 : -1);
            expect("any", Program.anyClaim(box(n)), n == 64 ? 64 : -1);
            expect("union", Program.unionClaim(box(n)), n == 0 || n == 1 || n == 2 || n == 3 ? n : -1);
            expect("enum", Program.enumClaim(box(n)), n == 3 || n == 7 ? n : -1);
            expect("member", Program.enumMemberClaim(box(n)), n == 64 ? 64 : -1);
            expect("recovered", Program.recoveredErasure(n), n == 64 ? 64 : -1);
            expect("typed number", Program.typedNumber(n), n);
            expect("typed union", Program.typedUnion(n), n);
            expect("typed enum", Program.typedEnum(n), n);
        }
        expect("string match", Program.stringClaim(box("a")), 1);
        expect("string mismatch", Program.stringClaim(box("b")), -1);
        expect("string wrong tag", Program.stringClaim(box(64.)), -1);
        expect("string union first", Program.stringUnionClaim(box("a")), 1);
        expect("string union second", Program.stringUnionClaim(box("b")), 1);
        expect("string union mismatch", Program.stringUnionClaim(box("c")), -1);
        expect("called mixed match", Program.throughMixedCall(box("a")), 1);
        expect("called mixed mismatch", Program.throughMixedCall(box("b")), -1);
        expect("finally match", Program.finalized(box(64.)), 641);
        expect("finally mismatch", Program.finalized(box(63.)), -9);
        expect("index match", Program.beforeIndexEffect(box("a")), 1);
        expect("index null", Program.beforeIndexEffect(box(null)), -10);
        expect("index undefined", Program.beforeIndexEffect(box(NtsValue.UNDEFINED_VALUE)), -10);
        expect("number wrong tag", Program.numberClaim(box("64")), -1);
        expect("mixed number", Program.mixedClaim(box(64.)), 64);
        expect("mixed string", Program.mixedClaim(box("a")), 1);
        expect("mixed other number", Program.mixedClaim(box(63.)), -1);
        expect("mixed other string", Program.mixedClaim(box("b")), -1);
        expect("nullable null", Program.nullableClaim(box(null)), 0);
        expect("nullable string", Program.nullableClaim(box("a")), 1);
        expect("nullable mismatch", Program.nullableClaim(box("b")), -1);
        expect("nullable undefined", Program.nullableClaim(box(NtsValue.UNDEFINED_VALUE)), -1);
        expect("boolean match", Program.booleanClaim(box(true)), 1);
        expect("boolean mismatch", Program.booleanClaim(box(false)), -1);
        expect("boolean wrong tag", Program.booleanClaim(box(1.)), -1);
        expect("zero", Program.zeroClaim(box(0.)), Double.POSITIVE_INFINITY);
        expect("negative zero", Program.zeroClaim(box(-0.)), Double.NEGATIVE_INFINITY);
        expect("bigint match", Program.bigintClaim(box(NtsBigInt.fromLong(64))), 1);
        expect("bigint mismatch", Program.bigintClaim(box(NtsBigInt.fromLong(65))), -1);
        expect("bigint wrong tag", Program.bigintClaim(box(64.)), -1);
        String text = new String("b");
        expect("typed string identity", Program.typedString(text) == text ? 1 : 0, 1);
        System.out.println(cases + " cases");
        if (failures != 0) System.exit(1);
    }
}
