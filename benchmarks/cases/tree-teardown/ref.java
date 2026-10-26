// Java leaves dead trees to its production collector; no System.gc() is added.
final class Ref extends Bench.Work {
    private static final class Tree {
        final int value;
        final Tree left, right;
        Tree(int value, Tree left, Tree right) {
            this.value = value; this.left = left; this.right = right;
        }
    }
    private static Tree build(int depth, int value) {
        if (depth == 0) return new Tree(value, null, null);
        return new Tree(value, build(depth - 1, value + 1), build(depth - 1, value + 3));
    }
    private static int sum(Tree tree) {
        int total = tree.value;
        if (tree.left != null) total += sum(tree.left);
        if (tree.right != null) total += sum(tree.right);
        return total;
    }
    static int work(int n) {
        n = (n & 3) + 1;
        int total = 0;
        for (int round = 0; round < 16 * n; round++) {
            Tree root = build(8, round);
            total += sum(root);
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
