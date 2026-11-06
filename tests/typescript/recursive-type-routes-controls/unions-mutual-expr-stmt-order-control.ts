/*---
description: "Mutually recursive Expr and Stmt preserve statement traversal order. Route: mutual-expr-stmt-order (control)"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Mutually recursive Expr and Stmt preserve statement traversal order. Route: mutual-expr-stmt-order. Node prints unions-mutual-expr-stmt-order:ok.
type E0={kind:"lit";value:number};type S0={kind:"emit";expr:E0};type S1=S0|{kind:"seq";steps:S0[]};type E1=E0|{kind:"block";stmt:S1};type ViewExpr=E1;type ViewStmt=S1;
function values(e:ViewExpr):number[]{if(e.kind==="lit")return [e.value];return fromStmt(e.stmt);}function fromStmt(s:ViewStmt):number[]{if(s.kind==="emit")return values(s.expr);const out:number[]=[];for(const step of s.steps)out.push(...fromStmt(step));return out;}
const expr:ViewExpr={kind:"block",stmt:{kind:"seq",steps:[{kind:"emit",expr:{kind:"lit",value:-0}},{kind:"emit",expr:{kind:"lit",value:NaN}}]}};const log:string[]=[];for(const v of values(expr))log.push(Object.is(v,-0)?'-0':String(v));assert.compareArray(log,['-0','NaN']);
console.log("unions-mutual-expr-stmt-order:ok");
