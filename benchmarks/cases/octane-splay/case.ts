// Copyright 2009 the V8 project authors. All rights reserved.
// Copyright 2013 the V8 project authors. All rights reserved. (base.js RNG)
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
//       copyright notice, this list of conditions and the following
//       disclaimer in the documentation and/or other materials provided
//       with the distribution.
//     * Neither the name of Google Inc. nor the names of its
//       contributors may be used to endorse or promote products derived
//       from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

// This benchmark is based on a JavaScript log processing module used
// by the V8 profiler to generate execution time profiles for runs of
// JavaScript applications, and it effectively measures how fast the
// JavaScript engine is at allocating nodes and reclaiming the memory
// used for old nodes. Because of the way splay trees work, the engine
// also has to deal with a lot of changes to the large tree object
// graph.

// Transcribed from Octane 2.0 splay.js, revision 570ad1ccfe86e3eecba0636c8f932ac08edec517:
// https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/splay.js
// Its deterministic generator is copied from the same revision's base.js:
// https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/base.js
// The Octane licence is also reproduced in ../LICENSE-octane.
//
// The prototype classes become classes with explicitly typed fields. Payload
// trees, key generation, the 80 insert/remove operations, and all splay
// rotations retain the original data and arithmetic. Only Octane's benchmark
// registration and clock/pause-score instrumentation are omitted.
//
// A harness call includes setup and teardown and resets the local generator.
// n sizes the initial tree so that this complete operation can be calibrated;
// Octane's original 8000-node configuration remains available as originalSize.
// The payload depth stays five. Octane's teardown validates the final size
// and sorted unique keys; work additionally hashes those exact 28-bit keys.

interface PayloadLeaf {
  array: number[];
  string: string;
}

interface PayloadBranch {
  left: Payload;
  right: Payload;
}

type Payload = PayloadLeaf | PayloadBranch;

// Configuration from Octane; only the initial tree size is parameterized.
const kSplayTreeSize = 8000;
const kSplayTreeModifications = 80;
const kSplayTreePayloadDepth = 5;
export const originalSize = kSplayTreeSize;

let splayTree: SplayTree | null = null;
let randomState: number = 49734321;

function GeneratePayloadTree(depth: number, tag: string): Payload {
  if (depth == 0) {
    return {
      array  : [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ],
      string : 'String for key ' + tag + ' in leaf node'
    };
  } else {
    return {
      left:  GeneratePayloadTree(depth - 1, tag),
      right: GeneratePayloadTree(depth - 1, tag)
    };
  }
}

function GenerateKey(): number {
  // The benchmark framework supplies this deterministic Math.random in
  // base.js. Keep it local instead of modifying the host's Math object.
  // Robert Jenkins' 32 bit integer hash function.
  randomState = ((randomState + 0x7ed55d16) + (randomState << 12))  & 0xffffffff;
  randomState = ((randomState ^ 0xc761c23c) ^ (randomState >>> 19)) & 0xffffffff;
  randomState = ((randomState + 0x165667b1) + (randomState << 5))   & 0xffffffff;
  randomState = ((randomState + 0xd3a2646c) ^ (randomState << 9))   & 0xffffffff;
  randomState = ((randomState + 0xfd7046c5) + (randomState << 3))   & 0xffffffff;
  randomState = ((randomState ^ 0xb55a4f09) ^ (randomState >>> 16)) & 0xffffffff;
  return (randomState & 0xfffffff) / 0x10000000;
}

function InsertNewNode(): number {
  // Insert new node with a unique key.
  var key: number;
  do {
    key = GenerateKey();
  } while (splayTree!.find(key) != null);
  var payload = GeneratePayloadTree(kSplayTreePayloadDepth, String(key));
  splayTree!.insert(key, payload);
  return key;
}

function SplaySetup(size: number): void {
  splayTree = new SplayTree();
  for (var i = 0; i < size; i++) {
    InsertNewNode();
  }
}

function SplayTearDown(size: number): number[] {
  // Allow the garbage collector to reclaim the memory
  // used by the splay tree no matter how we exit the
  // tear down function.
  var keys = splayTree!.exportKeys();
  splayTree = null;
  validateKeys(keys, size);
  return keys;
}

// Octane's own validation, with the configured tree size as an argument.
export function validateKeys(keys: number[], size: number): void {
  // Verify that the splay tree has the right size.
  var length = keys.length;
  if (length != size) {
    throw new Error("Splay tree has wrong size");
  }

  // Verify that the splay tree has sorted, unique keys.
  for (var i = 0; i < length - 1; i++) {
    if (keys[i] >= keys[i + 1]) {
      throw new Error("Splay tree not sorted");
    }
  }
}

function SplayRun(): void {
  // Replace a few nodes in the splay tree.
  for (var i = 0; i < kSplayTreeModifications; i++) {
    var key = InsertNewNode();
    var greatest = splayTree!.findGreatestLessThan(key);
    if (greatest == null) splayTree!.remove(key);
    else splayTree!.remove(greatest.key!);
  }
}

/**
 * Constructs a Splay tree.  A splay tree is a self-balancing binary
 * search tree with the additional property that recently accessed
 * elements are quick to access again. It performs basic operations
 * such as insertion, look-up and removal in O(log(n)) amortized time.
 *
 * @constructor
 */
class SplayTree {
  root_: SplayTreeNode | null = null;

  /**
   * @return {boolean} Whether the tree is empty.
   */
  isEmpty(): boolean {
    return !this.root_;
  }

  /**
   * Inserts a node into the tree with the specified key and value if
   * the tree does not already contain a node with the specified key. If
   * the value is inserted, it becomes the root of the tree.
   *
   * @param {number} key Key to insert into the tree.
   * @param {*} value Value to insert into the tree.
   */
  insert(key: number, value: Payload): void {
    if (this.isEmpty()) {
      this.root_ = new SplayTreeNode(key, value);
      return;
    }
    // Splay on the key to move the last node on the search path for
    // the key to the root of the tree.
    this.splay_(key);
    if (this.root_!.key! == key) {
      return;
    }
    var node = new SplayTreeNode(key, value);
    if (key > this.root_!.key!) {
      node.left = this.root_!;
      node.right = this.root_!.right;
      this.root_!.right = null;
    } else {
      node.right = this.root_!;
      node.left = this.root_!.left;
      this.root_!.left = null;
    }
    this.root_ = node;
  }

  /**
   * Removes a node with the specified key from the tree if the tree
   * contains a node with this key. The removed node is returned. If the
   * key is not found, an exception is thrown.
   *
   * @param {number} key Key to find and remove from the tree.
   * @return {SplayTreeNode} The removed node.
   */
  remove(key: number): SplayTreeNode {
    if (this.isEmpty()) {
      throw Error('Key not found: ' + key);
    }
    this.splay_(key);
    if (this.root_!.key! != key) {
      throw Error('Key not found: ' + key);
    }
    var removed = this.root_!;
    if (!this.root_!.left) {
      this.root_ = this.root_!.right;
    } else {
      var right = this.root_!.right;
      this.root_ = this.root_!.left;
      // Splay to make sure that the new root has an empty right child.
      this.splay_(key);
      // Insert the original right child as the right child of the new
      // root.
      this.root_!.right = right;
    }
    return removed;
  }

  /**
   * Returns the node having the specified key or null if the tree doesn't contain
   * a node with the specified key.
   *
   * @param {number} key Key to find in the tree.
   * @return {SplayTreeNode} Node having the specified key.
   */
  find(key: number): SplayTreeNode | null {
    if (this.isEmpty()) {
      return null;
    }
    this.splay_(key);
    return this.root_!.key! == key ? this.root_ : null;
  }

  /**
   * @return {SplayTreeNode} Node having the maximum key value.
   */
  findMax(opt_startNode?: SplayTreeNode | null): SplayTreeNode | null {
    if (this.isEmpty()) {
      return null;
    }
    var current = opt_startNode || this.root_!;
    while (current.right) {
      current = current.right;
    }
    return current;
  }

  /**
   * @return {SplayTreeNode} Node having the maximum key value that
   *     is less than the specified key value.
   */
  findGreatestLessThan(key: number): SplayTreeNode | null {
    if (this.isEmpty()) {
      return null;
    }
    // Splay on the key to move the node with the given key or the last
    // node on the search path to the top of the tree.
    this.splay_(key);
    // Now the result is either the root node or the greatest node in
    // the left subtree.
    if (this.root_!.key! < key) {
      return this.root_!;
    } else if (this.root_!.left) {
      return this.findMax(this.root_!.left);
    } else {
      return null;
    }
  }

  /**
   * @return {Array<*>} An array containing all the keys of tree's nodes.
   */
  exportKeys(): number[] {
    var result: number[] = [];
    if (!this.isEmpty()) {
      this.root_!.traverse_(function(node) { result.push(node.key!); });
    }
    return result;
  }

  /**
   * Perform the splay operation for the given key. Moves the node with
   * the given key to the top of the tree.  If no node has the given
   * key, the last node on the search path is moved to the top of the
   * tree. This is the simplified top-down splaying algorithm from:
   * "Self-adjusting Binary Search Trees" by Sleator and Tarjan
   *
   * @param {number} key Key to splay the tree on.
   * @private
   */
  splay_(key: number): void {
    if (this.isEmpty()) {
      return;
    }
    // Create a dummy node.  The use of the dummy node is a bit
    // counter-intuitive: The right child of the dummy node will hold
    // the L tree of the algorithm.  The left child of the dummy node
    // will hold the R tree of the algorithm.  Using a dummy node, left
    // and right will always be nodes and we avoid special cases.
    var dummy: SplayTreeNode, left: SplayTreeNode, right: SplayTreeNode;
    dummy = left = right = new SplayTreeNode(null, null);
    var current = this.root_!;
    while (true) {
      if (key < current.key!) {
        if (!current.left) {
          break;
        }
        if (key < current.left.key!) {
          // Rotate right.
          var tmp = current.left;
          current.left = tmp.right;
          tmp.right = current;
          current = tmp;
          if (!current.left) {
            break;
          }
        }
        // Link right.
        right.left = current;
        right = current;
        current = current.left!;
      } else if (key > current.key!) {
        if (!current.right) {
          break;
        }
        if (key > current.right.key!) {
          // Rotate left.
          var tmp = current.right;
          current.right = tmp.left;
          tmp.left = current;
          current = tmp;
          if (!current.right) {
            break;
          }
        }
        // Link left.
        left.right = current;
        left = current;
        current = current.right!;
      } else {
        break;
      }
    }
    // Assemble.
    left.right = current.left;
    right.left = current.right;
    current.left = dummy.right;
    current.right = dummy.left;
    this.root_ = current;
  }

}

/**
 * Constructs a Splay tree node.
 *
 * @param {number} key Key.
 * @param {*} value Value.
 */
class SplayTreeNode {
  key: number | null;
  value: Payload | null;
  left: SplayTreeNode | null = null;
  right: SplayTreeNode | null = null;

  constructor(key: number | null, value: Payload | null) {
    this.key = key;
    this.value = value;
  }

  /**
   * Performs an ordered traversal of the subtree starting at
   * this SplayTreeNode.
   *
   * @param {function(SplayTreeNode)} f Visitor function.
   * @private
   */
  traverse_(f: (node: SplayTreeNode) => void): void {
    var current: SplayTreeNode | null = this;
    while (current) {
      var left = current.left;
      if (left) left.traverse_(f);
      f(current);
      current = current.right;
    }
  }
}

// Return the original teardown's key array for the correctness test.
export function runSplay(n: number): number[] {
  randomState = 49734321;
  SplaySetup(n);
  SplayRun();
  return SplayTearDown(n);
}

export function work(n: number): number {
  const keys = runSplay(n);
  let checksum = 0;
  for (let i = 0; i < keys.length; i++) {
    checksum = (checksum * 31 + keys[i] * 0x10000000) >>> 0;
  }
  return checksum;
}

// The harness passes the initial tree size through its opaque input boundary.
export const seed = 2048;
