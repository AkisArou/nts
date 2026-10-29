import nts.gen.Program;

public final class Drive {
    public static void main(String[] args) throws Exception {
        Program.class.getMethod(args[0]).invoke(null);
        for (int n : new int[] { 0, 1, 3, 17 }) {
            System.out.println("linear/" + n + "=" + Program.linear(n));
            System.out.println("measured/" + n + "=" + (int)Program.measured(n));
            System.out.println("oldAlias/" + n + "=" + Program.oldAlias(n));
            System.out.println("duplicate/" + n + "=" + Program.duplicate(n));
            System.out.println("published/" + n + "=" + Program.published(n));
            System.out.println("caughtOld/" + n + "=" + Program.caughtOld(n));
            System.out.println("fieldAlias/" + n + "=" + Program.fieldAlias(n));
            System.out.println("indirect/" + n + "=" + Program.indirect(n));
            System.out.println("optional/" + n + "=" + Program.optional(n));
            System.out.println("discarded/" + n + "=" + (int)Program.discarded(n));
        }
    }
}
