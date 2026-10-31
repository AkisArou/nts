/*---
description: A returned field borrow survives 34 distinct call summaries and owner replacement.
features: [ts-lifetime-borrow, ts-route-return-chain, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: 34 return wrappers propagate a field alias; Node keeps identity, id, text and length.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function first(owner: { item: Cell }): Cell { return owner.item; }
function relay0(owner: { item: Cell }): Cell { return first(owner); }
function relay1(owner: { item: Cell }): Cell { return relay0(owner); }
function relay2(owner: { item: Cell }): Cell { return relay1(owner); }
function relay3(owner: { item: Cell }): Cell { return relay2(owner); }
function relay4(owner: { item: Cell }): Cell { return relay3(owner); }
function relay5(owner: { item: Cell }): Cell { return relay4(owner); }
function relay6(owner: { item: Cell }): Cell { return relay5(owner); }
function relay7(owner: { item: Cell }): Cell { return relay6(owner); }
function relay8(owner: { item: Cell }): Cell { return relay7(owner); }
function relay9(owner: { item: Cell }): Cell { return relay8(owner); }
function relay10(owner: { item: Cell }): Cell { return relay9(owner); }
function relay11(owner: { item: Cell }): Cell { return relay10(owner); }
function relay12(owner: { item: Cell }): Cell { return relay11(owner); }
function relay13(owner: { item: Cell }): Cell { return relay12(owner); }
function relay14(owner: { item: Cell }): Cell { return relay13(owner); }
function relay15(owner: { item: Cell }): Cell { return relay14(owner); }
function relay16(owner: { item: Cell }): Cell { return relay15(owner); }
function relay17(owner: { item: Cell }): Cell { return relay16(owner); }
function relay18(owner: { item: Cell }): Cell { return relay17(owner); }
function relay19(owner: { item: Cell }): Cell { return relay18(owner); }
function relay20(owner: { item: Cell }): Cell { return relay19(owner); }
function relay21(owner: { item: Cell }): Cell { return relay20(owner); }
function relay22(owner: { item: Cell }): Cell { return relay21(owner); }
function relay23(owner: { item: Cell }): Cell { return relay22(owner); }
function relay24(owner: { item: Cell }): Cell { return relay23(owner); }
function relay25(owner: { item: Cell }): Cell { return relay24(owner); }
function relay26(owner: { item: Cell }): Cell { return relay25(owner); }
function relay27(owner: { item: Cell }): Cell { return relay26(owner); }
function relay28(owner: { item: Cell }): Cell { return relay27(owner); }
function relay29(owner: { item: Cell }): Cell { return relay28(owner); }
function relay30(owner: { item: Cell }): Cell { return relay29(owner); }
function relay31(owner: { item: Cell }): Cell { return relay30(owner); }
function relay32(owner: { item: Cell }): Cell { return relay31(owner); }
function relay33(owner: { item: Cell }): Cell { return relay32(owner); }

for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  const kept = relay33(owner), same = relay33(owner);
  owner.item = make(-n - 1);
  const rows: Cell[] = [];
  for (let i = 0; i < 24; i++) rows.push(make(n + i + 1000));
  assert.sameValue(rows[23].id, n + 1023);
  assert.sameValue(kept === same, true);
  assert.sameValue(kept.id, n);
  assert.sameValue(kept.text, "cell/" + n);
  assert.sameValue(kept.text.length, ("cell/" + n).length);
}
