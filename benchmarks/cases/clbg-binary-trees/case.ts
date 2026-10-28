/*
 * The Computer Language Benchmarks Game -- BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * contributed by Léo Sarrazin
 * multi thread by Andrey Filatkin
 * sequential by Isaac Gouy
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/binarytrees-node-7.html
 */

// The single-threaded Node.js #7 program, with its command-line input passed
// as n and its console output collected into a string. Its two-field node is
// transcribed as a class so construction has a checked TypeScript layout;
// the recursive construction and item-check algorithms are unchanged.
class TreeNode {
  left: TreeNode | null;
  right: TreeNode | null;

  constructor(left: TreeNode | null, right: TreeNode | null) {
    this.left = left;
    this.right = right;
  }
}

function itemCheck(node: TreeNode): number {
  if (node.left === null) {
    return 1;
  }
  return 1 + itemCheck(node.left) + itemCheck(node.right!);
}

function bottomUpTree(depth: number): TreeNode {
  return depth > 0
    ? new TreeNode(bottomUpTree(depth - 1), bottomUpTree(depth - 1))
    : new TreeNode(null, null);
}

function trees(iterations: number, depth: number): string {
  let check = 0;
  for (let i = 0; i < iterations; i++) {
    check += itemCheck(bottomUpTree(depth));
  }
  return `${iterations}\t trees of depth ${depth}\t check: ${check}\n`;
}

/** The program's complete, unmodified stdout format. */
export function render(n: number): string {
  const maxDepth = Math.max(6, n);
  const stretchDepth = maxDepth + 1;
  const check = itemCheck(bottomUpTree(stretchDepth));
  let output = `stretch tree of depth ${stretchDepth}\t check: ${check}\n`;

  const longLivedTree = bottomUpTree(maxDepth);
  for (let depth = 4; depth <= maxDepth; depth += 2) {
    const iterations = 1 << (maxDepth - depth + 4);
    output += trees(iterations, depth);
  }
  output += `long lived tree of depth ${maxDepth}\t check: ${itemCheck(longLivedTree)}\n`;
  return output;
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; i++) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// The driver passes this input opaquely (argv in Node, volatile in the native
// and JVM drivers), so the optimizer cannot hoist work out of its timed loop.
export const seed = 12;
