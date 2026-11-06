/*---
description: "Mutually recursive Expr and Stmt preserve signed zero and NaN leaves. Route: mutual-expr-stmt-leaves"
features: [ts-recursive-type-routes, ts-recursive-type-route-unions]
---*/

// Mutually recursive Expr and Stmt preserve signed zero and NaN leaves. Route: mutual-expr-stmt-leaves. Node prints unions-mutual-expr-stmt-leaves:ok.
type Expr={kind:"lit";value:number}|{kind:"block";stmt:Stmt};type Stmt={kind:"emit";expr:Expr}|{kind:"seq";steps:Stmt[]};type ViewExpr=Expr;type ViewStmt=Stmt;
function values(e:ViewExpr):number[]{if(e.kind==="lit")return [e.value];return fromStmt(e.stmt);}function fromStmt(s:ViewStmt):number[]{if(s.kind==="emit")return values(s.expr);const out:number[]=[];for(const step of s.steps)out.push(...fromStmt(step));return out;}
const expr:ViewExpr={kind:"block",stmt:{kind:"seq",steps:[{kind:"emit",expr:{kind:"lit",value:-0}},{kind:"emit",expr:{kind:"lit",value:NaN}}]}};assert.compareArray(values(expr),[-0,NaN]);
console.log("unions-mutual-expr-stmt-leaves:ok");
