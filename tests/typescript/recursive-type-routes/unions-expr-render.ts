/*---
description: "A recursive expression renderer respects nested arm order. Route: expr-render"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A recursive expression renderer respects nested arm order. Route: expr-render. Node prints unions-expr-render:ok.
type Expr={kind:"num";value:number}|{kind:"neg";operand:Expr}|{kind:"add";left:Expr;right:Expr};type View=Expr;
function render(e:View):string{switch(e.kind){case "num":return Object.is(e.value,-0)?"-0":String(e.value);case "neg":return "(-"+render(e.operand)+")";case "add":return "("+render(e.left)+"+"+render(e.right)+")";}}
const input:View={kind:"add",left:{kind:"num",value:1},right:{kind:"neg",operand:{kind:"num",value:2}}};
assert.sameValue(render(input),"(1+(-2))");
console.log("unions-expr-render:ok");
