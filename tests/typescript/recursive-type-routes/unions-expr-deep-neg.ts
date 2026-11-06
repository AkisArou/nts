/*---
description: "Nested negative arms use the correct recursive layout. Route: expr-deep-neg"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested negative arms use the correct recursive layout. Route: expr-deep-neg. Node prints unions-expr-deep-neg:ok.
type Expr={kind:"num";value:number}|{kind:"neg";operand:Expr}|{kind:"add";left:Expr;right:Expr};type View=Expr;
function evaluate(e:View):number{switch(e.kind){case "num":return e.value;case "neg":return -evaluate(e.operand);case "add":return evaluate(e.left)+evaluate(e.right);}}
const input:View={kind:"neg",operand:{kind:"neg",operand:{kind:"num",value:5}}};
assert.sameValue(evaluate(input),5);
console.log("unions-expr-deep-neg:ok");
