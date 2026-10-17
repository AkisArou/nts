// expect: emit-c --rc -> a callback bridge whose closure publishes no function
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md):
// a NodeFilter -- a WebIDL *callback interface*, an object with one
// operation -- as createNodeIterator's (and createTreeWalker's) third
// argument. The closure a foreign function wants exists: declared as
// a number-answering closure (src/filter.d.ts, the spelling a callback
// *function* like canvas.toBlob's BlobCallback binds with), the call's
// triple is `double (*)(NtsDomNode*, void*)` and emits. What does not
// exist is taking it from the program's object: page script hands over
// `{ acceptNode(node) { ... } }` (lib.dom will not type a bare function
// there), and the bridge is given that object whole, whose layout
// publishes methods and no function, in every form -- method shorthand
// or stored here, an arrow-valued member refused one step earlier ("a
// property the type does not declare"), a struct with a closure member
// and a nullable closure each refused as a parameter ("a type with no
// native ABI"). The extraction also owes the operation its receiver:
// WebIDL calls acceptNode with the filter object as `this`, and Blink
// rethrows its exceptions out of nextNode() (NodeIteratorBase::
// AcceptNode). Found 2026-10-17 by the Chromium lane binding
// NodeFilter.
//
// Control, one difference -- the same iterator with no filter, the
// two-argument form bound today -- emits and walks:

export function go(): string {
  const plain = document.createNodeIterator(document, 1);
  const first = plain.nextNode();
  const it = document.createNodeIterator(document, 1, {
    acceptNode(node: Node): number { return node.nodeName === "DIV" ? 1 : 3; }
  });
  const n = it.nextNode();
  return (first === null ? "none" : first.nodeName) + "," + (n === null ? "none" : n.nodeName);
}
