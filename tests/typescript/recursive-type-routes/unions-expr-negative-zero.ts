/*---
description: "A recursive numeric expression retains a minus-zero leaf. Route: expr-negative-zero"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A recursive numeric expression retains a minus-zero leaf. Route: expr-negative-zero. Node prints unions-expr-negative-zero:ok.
type Expr={kind:"num";value:number}|{kind:"neg";operand:Expr}|{kind:"add";left:Expr;right:Expr};type View=Expr;
function evaluate(e:View):number{switch(e.kind){case "num":return e.value;case "neg":return -evaluate(e.operand);case "add":return evaluate(e.left)+evaluate(e.right);}}
const input:View={kind:"add",left:{kind:"num",value:-0},right:{kind:"num",value:0}};
assert.sameValue(input.kind==='add'?input.left.kind==='num'?input.left.value:9:9,-0);
console.log("unions-expr-negative-zero:ok");
