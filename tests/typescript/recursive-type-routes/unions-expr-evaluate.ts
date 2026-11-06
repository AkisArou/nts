/*---
description: "A recursive expression evaluator keeps nested discriminants. Route: expr-evaluate"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// A recursive expression evaluator keeps nested discriminants. Route: expr-evaluate. Node prints unions-expr-evaluate:ok.
type Expr={kind:"num";value:number}|{kind:"neg";operand:Expr}|{kind:"add";left:Expr;right:Expr};type View=Expr;
function evaluate(e:View):number{switch(e.kind){case "num":return e.value;case "neg":return -evaluate(e.operand);case "add":return evaluate(e.left)+evaluate(e.right);}}
const input:View={kind:"add",left:{kind:"num",value:4},right:{kind:"neg",operand:{kind:"num",value:2}}};
assert.sameValue(evaluate(input),2);
console.log("unions-expr-evaluate:ok");
