/*---
description: "A recursive expression renderer respects nested arm order. Route: expr-render (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A recursive expression renderer respects nested arm order. Route: expr-render. Node prints unions-expr-render:ok.
type E0={kind:"num";value:number};type E1=E0|{kind:"neg";operand:E0}|{kind:"add";left:E0;right:E0};type E2=E0|{kind:"neg";operand:E1}|{kind:"add";left:E1;right:E1};type E3=E0|{kind:"neg";operand:E2}|{kind:"add";left:E2;right:E2};type View=E0|E1|E2|E3;
function render(e:View):string{switch(e.kind){case "num":return Object.is(e.value,-0)?"-0":String(e.value);case "neg":return "(-"+render(e.operand)+")";case "add":return "("+render(e.left)+"+"+render(e.right)+")";}}
const input:View={kind:"add",left:{kind:"num",value:1},right:{kind:"neg",operand:{kind:"num",value:2}}};
assert.sameValue(render(input),"(1+(-2))");
console.log("unions-expr-render:ok");
