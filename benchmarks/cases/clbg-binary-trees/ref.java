/*
 * The Computer Language Benchmarks Game -- BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Loosely based on Jarkko Miettinen's implementation. Requires Java 8.
 * contributed by Heikki Salokanto.
 * modified by Chandra Sekar
 * modified by Mike Krüger
 * *reset*
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/binarytrees-javavm-6.html
 */

// The upstream single-threaded Java #6 program. Its node allocation, recursive
// walk and loop arithmetic remain unchanged; stdout becomes a StringBuilder.
final class Ref extends Bench.Work {
    private static volatile double input = 12;

    @Override public double run() {
        String output = render((int) input);
        int hash = 0;
        for (int i = 0; i < output.length(); i++) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }

    static String render(int n) {
        int minDepth = 4;
        int maxDepth = Math.max(minDepth + 2, n);
        int stretchDepth = maxDepth + 1;
        int check = (TreeNode.create(stretchDepth)).check();
        StringBuilder output = new StringBuilder();

        output.append("stretch tree of depth ").append(maxDepth + 1)
            .append("\t check: ").append(check).append('\n');

        TreeNode longLivedTree = TreeNode.create(maxDepth);
        for (int depth = minDepth; depth <= maxDepth; depth += 2) {
            int iterations = 1 << (maxDepth - depth + minDepth);
            check = 0;
            for (int i = 1; i <= iterations; i++) {
                check += (TreeNode.create(depth)).check();
            }
            output.append(iterations).append("\t trees of depth ")
                .append(depth).append("\t check: ").append(check).append('\n');
        }
        output.append("long lived tree of depth ").append(maxDepth)
            .append("\t check: ").append(longLivedTree.check()).append('\n');
        return output.toString();
    }

    static class TreeNode {
        TreeNode left, right;

        static TreeNode create(int depth) {
            return ChildTreeNodes(depth);
        }

        static TreeNode ChildTreeNodes(int depth) {
            TreeNode node = new TreeNode();
            if (depth > 0) {
                node.left = ChildTreeNodes(depth - 1);
                node.right = ChildTreeNodes(depth - 1);
            }
            return node;
        }

        int check() {
            return left == null ? 1 : left.check() + right.check() + 1;
        }
    }
}
