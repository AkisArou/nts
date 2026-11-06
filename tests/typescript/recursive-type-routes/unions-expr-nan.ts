/*---
description: "NaN survives inside a recursive discriminated expression. Route: expr-nan"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// NaN survives inside a recursive discriminated expression. Route: expr-nan. Node prints unions-expr-nan:ok.
type Expr={kind:"num";value:number}|{kind:"neg";operand:Expr}|{kind:"add";left:Expr;right:Expr};type View=Expr;
function evaluate(e:View):number{switch(e.kind){case "num":return e.value;case "neg":return -evaluate(e.operand);case "add":return evaluate(e.left)+evaluate(e.right);}}
const input:View={kind:"neg",operand:{kind:"add",left:{kind:"num",value:NaN},right:{kind:"num",value:0}}};
assert.sameValue(evaluate(input),NaN);
console.log("unions-expr-nan:ok");
