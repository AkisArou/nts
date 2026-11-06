/*---
description: "Nested negative arms use the correct recursive layout. Route: expr-deep-neg (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Nested negative arms use the correct recursive layout. Route: expr-deep-neg. Node prints unions-expr-deep-neg:ok.
type E0={kind:"num";value:number};type E1=E0|{kind:"neg";operand:E0}|{kind:"add";left:E0;right:E0};type E2=E0|{kind:"neg";operand:E1}|{kind:"add";left:E1;right:E1};type E3=E0|{kind:"neg";operand:E2}|{kind:"add";left:E2;right:E2};type View=E0|E1|E2|E3;
function evaluate(e:View):number{switch(e.kind){case "num":return e.value;case "neg":return -evaluate(e.operand);case "add":return evaluate(e.left)+evaluate(e.right);}}
const input:View={kind:"neg",operand:{kind:"neg",operand:{kind:"num",value:5}}};
assert.sameValue(evaluate(input),5);
console.log("unions-expr-deep-neg:ok");
