// Control for a-constrained-tree-walk-uses-its-bound-at-a-generic-helper-call.
// Only the unused Comparable<K> constraint on RedBlackTree changes.
// The source creates Node<Key, number>; the constrained helper copy instead
// receives Node<Comparable<Key>, number>, while its call still carries Node<Key, number>.
// This is a lowering substitution finding, not a second source-level instantiation.
// Copyright (c) 2001-2010, Purdue University. All rights reserved.
// Copyright (C) 2015 Apple Inc. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//  * Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
//  * Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//  * Neither the name of the Purdue University nor the
//    names of its contributors may be used to endorse or promote products
//    derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

// Reduced from AWFY CD, upstream74306fec151070fd07157cefeacf19e7e0bcdc89.
interface Comparable<T> { compareTo(other: T): number; }
class Key implements Comparable<Key> {
  value: number;
  constructor(value: number) { this.value = value; }
  compareTo(other: Key): number { return this.value - other.value; }
}
class Entry<K,V> {
  key: K; value: V;
  constructor(key: K,value: V) { this.key=key;this.value=value; }
}
function treeMinimum<K,V>(x: Node<K,V>): Node<K,V> {
  let current=x;
  while(current.left) current=current.left;
  return current;
}
class Node<K,V> {
  key: K;value: V;
  left: Node<K,V>|null;right: Node<K,V>|null;parent: Node<K,V>|null;
  constructor(key: K,value: V) { this.key=key;this.value=value;this.left=null;this.right=null;this.parent=null; }
  successor(): Node<K,V>|null {
    let x: Node<K,V>=this;
    if(x.right)return treeMinimum(x.right);
    let y=x.parent;
    while(y&&x===y.right){x=y;y=y.parent;}
    return y;
  }
}
class RedBlackTree<K,V> {
  root: Node<K,V>|null;
  constructor(key: K,value: V) { this.root=new Node(key,value); }
  forEach(callback:(e: Entry<K,V>)=>void):void {
    if(!this.root)return;
    let current:Node<K,V>|null=treeMinimum(this.root);
    while(current){callback(new Entry(current.key,current.value));current=current.successor();}
  }
}
export function work(n:number):number {
  let total=0;
  const tree=new RedBlackTree<Key,number>(new Key(n),n);
  tree.forEach(e=>{total+=e.value;});
  return total;
}
