import { NumberArray, NumberFunction } from "./number.ts";
import type { NonEmptyDimensions } from "./number.ts";
import { createRNGWithRandomSeed } from "./random.ts";
import type { State } from "./state.ts";
import type { BinaryNumericExpression, ConstantExpression, DefStatement, DimStatement, EqualityExpression, Execution, ForStatement, IfStatement, InputStatement, JumpStatement, LetStatement, NegateExpression, NextStatement, NumberApplyExpression, OnStatement, OrderedExpression, PrintStatement, Program, Statement, StringVariableExpression, VariableApplyExpression } from "./types.ts";
export interface BasicOperations {
NumberApply(this: NumberApplyExpression, state: State): number
;
Variable(this: VariableApplyExpression, state: State): import("./number.ts").NumberValue
;
Const<T>(this: ConstantExpression<T>, state: State): T
;
NumberPow(this: BinaryNumericExpression, state: State): number
;
NumberMul(this: BinaryNumericExpression, state: State): number
;
NumberDiv(this: BinaryNumericExpression, state: State): number
;
NumberNeg(this: NegateExpression, state: State): number
;
NumberAdd(this: BinaryNumericExpression, state: State): number
;
NumberSub(this: BinaryNumericExpression, state: State): number
;
StringVar(this: StringVariableExpression, state: State): string
;
Equals(this: EqualityExpression, state: State): boolean
;
NotEquals(this: EqualityExpression, state: State): boolean
;
LessThan(this: OrderedExpression, state: State): boolean
;
GreaterThan(this: OrderedExpression, state: State): boolean
;
LessEqual(this: OrderedExpression, state: State): boolean
;
GreaterEqual(this: OrderedExpression, state: State): boolean
;
GoTo(this: JumpStatement, state: State): Execution
;
GoSub(this: JumpStatement, state: State): Execution
;
Def(this: DefStatement, state: State): Execution
;
Let(this: LetStatement, state: State): Execution
;
If(this: IfStatement, state: State): Execution
;
Return(this: Statement, state: State): Execution
;
Stop(this: Statement, state: State): Execution
;
On(this: OnStatement, state: State): Execution
;
For(this: ForStatement, state: State): Execution
;
Next: { (this: NextStatement, state: State): Execution
; isBlockEnd?: boolean; };
Print(this: PrintStatement, state: State): Execution
;
Input(this: InputStatement, state: State): Execution
;
Read(this: InputStatement, state: State): Execution
;
Restore(this: Statement, state: State): Execution
;
Dim(this: DimStatement, state: State): Execution
;
Randomize(this: Statement, state: State): Execution
;
End: { (this: Statement, state: State): Execution
; isBlockEnd?: boolean; };
Program(this: Program, state: State): Execution
;
}
