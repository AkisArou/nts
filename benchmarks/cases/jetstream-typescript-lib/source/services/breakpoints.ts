// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/breakpoints.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isArrowFunction, isVariableDeclaration, isParameter } from "../compiler/factory/nodeTests.ts";
import { isCompilerSyntaxNode } from "../checkedTypes.ts";
import { isNodeLayout_1ca01a4c8123 } from "../checkedLayouts.ts";
import { requireCompilerMember } from "../checked.ts";
import { isNodeLayout_ec9c5ff1c177, isNodeLayout_feebc7a44c8e, isNodeLayout_f909bad38188, isNodeLayout_285fbf0b7b95 } from "../checkedLayouts.ts";
import { isBindingPattern as checked_isBindingPattern } from "./_namespaces/ts.ts";
import { isVariableDeclarationList as checked_isVariableDeclarationList } from "./_namespaces/ts.ts";
import { checkedCompilerLayout, present } from "../checked.ts";
import { isVariableStatement as checked_isVariableStatement } from "../compiler/factory/nodeTests.ts";
import { isParameter as checked_isParameter } from "../compiler/factory/nodeTests.ts";
import { isFunctionLikeDeclaration as checked_isFunctionLikeDeclaration } from "../compiler/utilitiesPublic.ts";
import { isBlock as checked_isBlock } from "../compiler/factory/nodeTests.ts";
import { isCatchClause as checked_isCatchClause } from "../compiler/factory/nodeTests.ts";
import { isExpressionStatement as checked_isExpressionStatement } from "../compiler/factory/nodeTests.ts";
import { isReturnStatement as checked_isReturnStatement } from "../compiler/factory/nodeTests.ts";
import { isWhileStatement as checked_isWhileStatement } from "../compiler/factory/nodeTests.ts";
import { isDoStatement as checked_isDoStatement } from "../compiler/factory/nodeTests.ts";
import { isIfStatement as checked_isIfStatement } from "../compiler/factory/nodeTests.ts";
import { isLabeledStatement as checked_isLabeledStatement } from "../compiler/factory/nodeTests.ts";
import { isBreakOrContinueStatement as checked_isBreakOrContinueStatement } from "../compiler/utilitiesPublic.ts";
import { isForStatement as checked_isForStatement } from "../compiler/factory/nodeTests.ts";
import { isForInStatement as checked_isForInStatement } from "../compiler/factory/nodeTests.ts";
import { isForOfStatement as checked_isForOfStatement } from "../compiler/factory/nodeTests.ts";
import { isSwitchStatement as checked_isSwitchStatement } from "../compiler/factory/nodeTests.ts";
import { isCaseOrDefaultClause as checked_isCaseOrDefaultClause } from "../compiler/utilitiesPublic.ts";
import { isTryStatement as checked_isTryStatement } from "../compiler/factory/nodeTests.ts";
import { isThrowStatement as checked_isThrowStatement } from "../compiler/factory/nodeTests.ts";
import { isExportAssignment as checked_isExportAssignment } from "../compiler/factory/nodeTests.ts";
import { isImportEqualsDeclaration as checked_isImportEqualsDeclaration } from "../compiler/factory/nodeTests.ts";
import { isImportDeclaration as checked_isImportDeclaration } from "../compiler/factory/nodeTests.ts";
import { isExportDeclaration as checked_isExportDeclaration } from "../compiler/factory/nodeTests.ts";
import { isModuleDeclaration as checked_isModuleDeclaration } from "../compiler/factory/nodeTests.ts";
import { isWithStatement as checked_isWithStatement } from "../compiler/factory/nodeTests.ts";
import { isBinaryExpression as checked_isBinaryExpression } from "../compiler/factory/nodeTests.ts";
import { isPropertyAssignment as checked_isPropertyAssignment } from "../compiler/factory/nodeTests.ts";
import { isVariableDeclaration as checked_isVariableDeclaration } from "../compiler/factory/nodeTests.ts";
import { isEnumDeclaration as checked_isEnumDeclaration } from "../compiler/factory/nodeTests.ts";
import { isClassDeclaration as checked_isClassDeclaration } from "../compiler/factory/nodeTests.ts";
import { isCaseBlock as checked_isCaseBlock } from "../compiler/factory/nodeTests.ts";
import { isObjectLiteralExpression as checked_isObjectLiteralExpression } from "../compiler/factory/nodeTests.ts";
import { isArrayLiteralExpression as checked_isArrayLiteralExpression } from "../compiler/factory/nodeTests.ts";
import { type ArrayLiteralExpression, type BinaryExpression, type BindingPattern, type Block, type BreakOrContinueStatement, canHaveDecorators, type CaseBlock, type CaseOrDefaultClause, type CatchClause, type ClassDeclaration, createTextSpanFromBounds, Debug, type DestructuringPattern, type DoStatement, type EnumDeclaration, type ExportAssignment, type ExportDeclaration, type Expression, type ExpressionStatement, findLast, findNextToken, findPrecedingToken, forEach, type ForInStatement, type ForOfStatement, type ForStatement, type FunctionLikeDeclaration, getModuleInstanceState, getTokenAtPosition, type HasDecorators, hasOnlyExpressionInitializer, hasSyntacticModifier, type IfStatement, type ImportDeclaration, type ImportEqualsDeclaration, isArrayLiteralOrObjectLiteralDestructuringPattern, isAssignmentOperator, isBindingPattern, isDecorator, isExpressionNode, isFunctionBlock, isFunctionLike, isVariableDeclarationList, type LabeledStatement, lastOrUndefined, ModifierFlags, type ModuleDeclaration, ModuleInstanceState, type Node, type NodeArray, NodeFlags, type ObjectLiteralElement, type ObjectLiteralExpression, type ParameterDeclaration, type PropertyAssignment, type PropertyDeclaration, type PropertySignature, type ReturnStatement, skipTrivia, type SourceFile, type SwitchStatement, SyntaxKind, type TextSpan, type ThrowStatement, type TryStatement, type TypeAssertion, type VariableDeclaration, type VariableDeclarationList, type VariableStatement, type WhileStatement, type WithStatement } from "./_namespaces/ts.ts";
/**
 * Get the breakpoint span in given sourceFile
 *
 * @internal
 */
export function spanInSourceFileAtLocation(sourceFile: SourceFile, position: number): TextSpan | undefined {
    // Cannot set breakpoint in dts file
    if (sourceFile.isDeclarationFile) {
        return undefined;
    }
    let tokenAtLocation = getTokenAtPosition(sourceFile, position);
    const lineOfPosition = requireCompilerMember(sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(position).line;
    if (requireCompilerMember(sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(tokenAtLocation, "getStart").getStart(sourceFile)).line > lineOfPosition) {
        // Get previous token if the token is returned starts on new line
        // eg: let x =10; |--- cursor is here
        //     let y = 10;
        // token at position will return let keyword on second line as the token but we would like to use
        // token on same line if trailing trivia (comments or white spaces on same line) part of the last token on that line
        const preceding = findPrecedingToken(tokenAtLocation.pos, sourceFile);
        // It's a blank line
        if (!preceding || requireCompilerMember(sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(preceding, "getEnd").getEnd()).line !== lineOfPosition) {
            return undefined;
        }
        tokenAtLocation = preceding;
    }
    // Cannot set breakpoint in ambient declarations
    if (tokenAtLocation.flags & NodeFlags.Ambient) {
        return undefined;
    }
    // Get the span in the node based on its syntax
    return spanInNode(tokenAtLocation);
    function textSpan(startNode: Node, endNode?: Node) {
        const lastDecorator = canHaveDecorators(startNode) ? findLast(startNode.modifiers, isDecorator) : undefined;
        const start = lastDecorator ?
            skipTrivia(sourceFile.text, lastDecorator.end) :
            requireCompilerMember(startNode, "getStart").getStart(sourceFile);
        return createTextSpanFromBounds(start, requireCompilerMember((endNode || startNode), "getEnd").getEnd());
    }
    function textSpanEndingAtNextToken(startNode: Node, previousTokenToFindNextEndToken: Node): TextSpan {
        return textSpan(startNode, findNextToken(previousTokenToFindNextEndToken, (previousTokenToFindNextEndToken.parent)!, sourceFile));
    }
    function spanInNodeIfStartsOnSameLine(node: Node | undefined, otherwiseOnNode?: Node): TextSpan | undefined {
        if (node && lineOfPosition === requireCompilerMember(sourceFile, "getLineAndCharacterOfPosition").getLineAndCharacterOfPosition(requireCompilerMember(node, "getStart").getStart(sourceFile)).line) {
            return spanInNode(node);
        }
        return spanInNode(otherwiseOnNode);
    }
    function spanInNodeArray<T extends Node>(nodeArray: NodeArray<T> | undefined, node: T, match: (value: Node) => boolean) {
        if (nodeArray) {
            const index = nodeArray.indexOf(node);
            if (index >= 0) {
                let start = index;
                let end = index + 1;
                while (start > 0 && match(nodeArray[start - 1]))
                    start--;
                while (end < nodeArray.length && match(nodeArray[end]))
                    end++;
                return createTextSpanFromBounds(skipTrivia(sourceFile.text, nodeArray[start].pos), nodeArray[end - 1].end);
            }
        }
        return textSpan(node);
    }
    function spanInPreviousNode(node: Node): TextSpan | undefined {
        return spanInNode(findPrecedingToken(node.pos, sourceFile));
    }
    function spanInNextNode(node: Node): TextSpan | undefined {
        return spanInNode(findNextToken(node, (node.parent)!, sourceFile));
    }
    function spanInNode(node: Node | undefined): TextSpan | undefined {
        if (node) {
            const { parent } = node;
            switch (node.kind) {
                case SyntaxKind.VariableStatement:
                    // Span on first variable declaration
                    return spanInVariableDeclaration((checkedCompilerLayout(node, checked_isVariableStatement)).declarationList.declarations[0]);
                case SyntaxKind.VariableDeclaration:
                case SyntaxKind.PropertyDeclaration:
                case SyntaxKind.PropertySignature:
                    return spanInVariableDeclaration(checkedCompilerLayout(node, isNodeLayout_ec9c5ff1c177));
                case SyntaxKind.Parameter:
                    return spanInParameterDeclaration(checkedCompilerLayout(node, checked_isParameter));
                case SyntaxKind.FunctionDeclaration:
                case SyntaxKind.MethodDeclaration:
                case SyntaxKind.MethodSignature:
                case SyntaxKind.GetAccessor:
                case SyntaxKind.SetAccessor:
                case SyntaxKind.Constructor:
                case SyntaxKind.FunctionExpression:
                case SyntaxKind.ArrowFunction:
                    return spanInFunctionDeclaration(checkedCompilerLayout(node, checked_isFunctionLikeDeclaration));
                case SyntaxKind.Block:
                    if (isFunctionBlock(node)) {
                        return spanInFunctionBlock(checkedCompilerLayout(node, checked_isBlock));
                    }
                // falls through
                case SyntaxKind.ModuleBlock:
                    return spanInBlock(checkedCompilerLayout(node, checked_isBlock));
                case SyntaxKind.CatchClause:
                    return spanInBlock((checkedCompilerLayout(node, checked_isCatchClause)).block);
                case SyntaxKind.ExpressionStatement:
                    // span on the expression
                    return textSpan((checkedCompilerLayout(node, checked_isExpressionStatement)).expression);
                case SyntaxKind.ReturnStatement:
                    // span on return keyword and expression if present
                    return textSpan(requireCompilerMember(node, "getChildAt").getChildAt(0), (checkedCompilerLayout(node, checked_isReturnStatement)).expression);
                case SyntaxKind.WhileStatement:
                    // Span on while(...)
                    return textSpanEndingAtNextToken(node, (checkedCompilerLayout(node, checked_isWhileStatement)).expression);
                case SyntaxKind.DoStatement:
                    // span in statement of the do statement
                    return spanInNode((checkedCompilerLayout(node, checked_isDoStatement)).statement);
                case SyntaxKind.DebuggerStatement:
                    // span on debugger keyword
                    return textSpan(requireCompilerMember(node, "getChildAt").getChildAt(0));
                case SyntaxKind.IfStatement:
                    // set on if(..) span
                    return textSpanEndingAtNextToken(node, (checkedCompilerLayout(node, checked_isIfStatement)).expression);
                case SyntaxKind.LabeledStatement:
                    // span in statement
                    return spanInNode((checkedCompilerLayout(node, checked_isLabeledStatement)).statement);
                case SyntaxKind.BreakStatement:
                case SyntaxKind.ContinueStatement:
                    // On break or continue keyword and label if present
                    return textSpan(requireCompilerMember(node, "getChildAt").getChildAt(0), (checkedCompilerLayout(node, checked_isBreakOrContinueStatement)).label);
                case SyntaxKind.ForStatement:
                    return spanInForStatement(checkedCompilerLayout(node, checked_isForStatement));
                case SyntaxKind.ForInStatement:
                    // span of for (a in ...)
                    return textSpanEndingAtNextToken(node, (checkedCompilerLayout(node, checked_isForInStatement)).expression);
                case SyntaxKind.ForOfStatement:
                    // span in initializer
                    return spanInInitializerOfForLike(checkedCompilerLayout(node, checked_isForOfStatement));
                case SyntaxKind.SwitchStatement:
                    // span on switch(...)
                    return textSpanEndingAtNextToken(node, (checkedCompilerLayout(node, checked_isSwitchStatement)).expression);
                case SyntaxKind.CaseClause:
                case SyntaxKind.DefaultClause:
                    // span in first statement of the clause
                    return spanInNode((checkedCompilerLayout(node, checked_isCaseOrDefaultClause)).statements[0]);
                case SyntaxKind.TryStatement:
                    // span in try block
                    return spanInBlock((checkedCompilerLayout(node, checked_isTryStatement)).tryBlock);
                case SyntaxKind.ThrowStatement:
                    // span in throw ...
                    return textSpan(node, (checkedCompilerLayout(node, checked_isThrowStatement)).expression);
                case SyntaxKind.ExportAssignment:
                    // span on export = id
                    return textSpan(node, (checkedCompilerLayout(node, checked_isExportAssignment)).expression);
                case SyntaxKind.ImportEqualsDeclaration:
                    // import statement without including semicolon
                    return textSpan(node, (checkedCompilerLayout(node, checked_isImportEqualsDeclaration)).moduleReference);
                case SyntaxKind.ImportDeclaration:
                    // import statement without including semicolon
                    return textSpan(node, (checkedCompilerLayout(node, checked_isImportDeclaration)).moduleSpecifier);
                case SyntaxKind.ExportDeclaration:
                    // import statement without including semicolon
                    return textSpan(node, (checkedCompilerLayout(node, checked_isExportDeclaration)).moduleSpecifier);
                case SyntaxKind.ModuleDeclaration:
                    // span on complete module if it is instantiated
                    if (getModuleInstanceState(checkedCompilerLayout(node, checked_isModuleDeclaration)) !== ModuleInstanceState.Instantiated) {
                        return undefined;
                    }
                // falls through
                case SyntaxKind.ClassDeclaration:
                case SyntaxKind.EnumDeclaration:
                case SyntaxKind.EnumMember:
                case SyntaxKind.BindingElement:
                    // span on complete node
                    return textSpan(node);
                case SyntaxKind.WithStatement:
                    // span in statement
                    return spanInNode((checkedCompilerLayout(node, checked_isWithStatement)).statement);
                case SyntaxKind.Decorator:
                    return spanInNodeArray(checkedCompilerLayout(((parent))!, isNodeLayout_feebc7a44c8e).modifiers, node, isDecorator);
                case SyntaxKind.ObjectBindingPattern:
                case SyntaxKind.ArrayBindingPattern:
                    return spanInBindingPattern(checkedCompilerLayout(node, checked_isBindingPattern));
                // No breakpoint in interface, type alias
                case SyntaxKind.InterfaceDeclaration:
                case SyntaxKind.TypeAliasDeclaration:
                    return undefined;
                // Tokens:
                case SyntaxKind.SemicolonToken:
                case SyntaxKind.EndOfFileToken:
                    return spanInNodeIfStartsOnSameLine(findPrecedingToken(node.pos, sourceFile));
                case SyntaxKind.CommaToken:
                    return spanInPreviousNode(node);
                case SyntaxKind.OpenBraceToken:
                    return spanInOpenBraceToken(node);
                case SyntaxKind.CloseBraceToken:
                    return spanInCloseBraceToken(node);
                case SyntaxKind.CloseBracketToken:
                    return spanInCloseBracketToken(node);
                case SyntaxKind.OpenParenToken:
                    return spanInOpenParenToken(node);
                case SyntaxKind.CloseParenToken:
                    return spanInCloseParenToken(node);
                case SyntaxKind.ColonToken:
                    return spanInColonToken(node);
                case SyntaxKind.GreaterThanToken:
                case SyntaxKind.LessThanToken:
                    return spanInGreaterThanOrLessThanToken(node);
                // Keywords:
                case SyntaxKind.WhileKeyword:
                    return spanInWhileKeyword(node);
                case SyntaxKind.ElseKeyword:
                case SyntaxKind.CatchKeyword:
                case SyntaxKind.FinallyKeyword:
                    return spanInNextNode(node);
                case SyntaxKind.OfKeyword:
                    return spanInOfKeyword(node);
                default:
                    // Destructuring pattern in destructuring assignment
                    // [a, b, c] of
                    // [a, b, c] = expression
                    if (isArrayLiteralOrObjectLiteralDestructuringPattern(node)) {
                        return spanInArrayLiteralOrObjectLiteralDestructuringPattern(checkedCompilerLayout(node, isNodeLayout_f909bad38188));
                    }
                    // Set breakpoint on identifier element of destructuring pattern
                    // `a` or `...c` or `d: x` from
                    // `[a, b, ...c]` or `{ a, b }` or `{ d: x }` from destructuring pattern
                    if ((node.kind === SyntaxKind.Identifier ||
                        node.kind === SyntaxKind.SpreadElement ||
                        node.kind === SyntaxKind.PropertyAssignment ||
                        node.kind === SyntaxKind.ShorthandPropertyAssignment) &&
                        isArrayLiteralOrObjectLiteralDestructuringPattern((parent)!)) {
                        return textSpan(node);
                    }
                    if (node.kind === SyntaxKind.BinaryExpression) {
                        const { left, operatorToken } = checkedCompilerLayout(node, checked_isBinaryExpression);
                        // Set breakpoint in destructuring pattern if its destructuring assignment
                        // [a, b, c] or {a, b, c} of
                        // [a, b, c] = expression or
                        // {a, b, c} = expression
                        if (isArrayLiteralOrObjectLiteralDestructuringPattern(left)) {
                            return spanInArrayLiteralOrObjectLiteralDestructuringPattern(checkedCompilerLayout(left, isNodeLayout_f909bad38188));
                        }
                        if (operatorToken.kind === SyntaxKind.EqualsToken && isArrayLiteralOrObjectLiteralDestructuringPattern((node.parent)!)) {
                            // Set breakpoint on assignment expression element of destructuring pattern
                            // a = expression of
                            // [a = expression, b, c] = someExpression or
                            // { a = expression, b, c } = someExpression
                            return textSpan(node);
                        }
                        if (operatorToken.kind === SyntaxKind.CommaToken) {
                            return spanInNode(left);
                        }
                    }
                    if (isExpressionNode(node)) {
                        switch ((parent)!.kind) {
                            case SyntaxKind.DoStatement:
                                // Set span as if on while keyword
                                return spanInPreviousNode(node);
                            case SyntaxKind.Decorator:
                                // Set breakpoint on the decorator emit
                                return spanInNode(node.parent);
                            case SyntaxKind.ForStatement:
                            case SyntaxKind.ForOfStatement:
                                return textSpan(node);
                            case SyntaxKind.BinaryExpression:
                                if (((checkedCompilerLayout(node.parent, checked_isBinaryExpression)))!.operatorToken.kind === SyntaxKind.CommaToken) {
                                    // If this is a comma expression, the breakpoint is possible in this expression
                                    return textSpan(node);
                                }
                                break;
                            case SyntaxKind.ArrowFunction:
                                if (checkedCompilerLayout(node.parent!, isArrowFunction).body === node) {
                                    // If this is body of arrow function, it is allowed to have the breakpoint
                                    return textSpan(node);
                                }
                                break;
                        }
                    }
                    switch ((node.parent)!.kind) {
                        case SyntaxKind.PropertyAssignment:
                            // If this is name of property assignment, set breakpoint in the initializer
                            if (((checkedCompilerLayout(node.parent, checked_isPropertyAssignment)))!.name === node &&
                                !isArrayLiteralOrObjectLiteralDestructuringPattern(((node.parent)!.parent)!)) {
                                return spanInNode(((checkedCompilerLayout(node.parent, checked_isPropertyAssignment)))!.initializer);
                            }
                            break;
                        case SyntaxKind.TypeAssertionExpression:
                            // Breakpoint in type assertion goes to its operand
                            if (checkedCompilerLayout(((node.parent))!, isNodeLayout_285fbf0b7b95).type === node) {
                                return spanInNextNode(checkedCompilerLayout(((node.parent))!, isNodeLayout_285fbf0b7b95).type);
                            }
                            break;
                        case SyntaxKind.VariableDeclaration:
                        case SyntaxKind.Parameter: {
                            // initializer of variable/parameter declaration go to previous node
                            const { initializer, type } = checkedCompilerLayout(node.parent!, isBreakpointVariable);
                            if (initializer === node || type === node || isAssignmentOperator(node.kind)) {
                                return spanInPreviousNode(node);
                            }
                            break;
                        }
                        case SyntaxKind.BinaryExpression: {
                            const { left } = checkedCompilerLayout(node.parent!, checked_isBinaryExpression);
                            if (isArrayLiteralOrObjectLiteralDestructuringPattern(left) && node !== left) {
                                // If initializer of destructuring assignment move to previous token
                                return spanInPreviousNode(node);
                            }
                            break;
                        }
                        default:
                            // return type of function go to previous token
                            if (isFunctionLike(node.parent) && node.parent.type === node) {
                                return spanInPreviousNode(node);
                            }
                    }
                    // Default go to parent to set the breakpoint
                    return spanInNode(node.parent);
            }
        }
        function textSpanFromVariableDeclaration(variableDeclaration: VariableDeclaration | PropertyDeclaration | PropertySignature): TextSpan {
            if (isVariableDeclarationList(variableDeclaration.parent) && variableDeclaration.parent.declarations[0] === variableDeclaration) {
                // First declaration - include let keyword
                return textSpan((findPrecedingToken(variableDeclaration.pos, sourceFile, variableDeclaration.parent))!, variableDeclaration);
            }
            else {
                // Span only on this declaration
                return textSpan(variableDeclaration);
            }
        }
        function spanInVariableDeclaration(variableDeclaration: VariableDeclaration | PropertyDeclaration | PropertySignature): TextSpan | undefined {
            // If declaration of for in statement, just set the span in parent
            if ((variableDeclaration.parent.parent)!.kind === SyntaxKind.ForInStatement) {
                return spanInNode(variableDeclaration.parent.parent);
            }
            const parent = variableDeclaration.parent;
            // If this is a destructuring pattern, set breakpoint in binding pattern
            if (isBindingPattern(variableDeclaration.name)) {
                return spanInBindingPattern(variableDeclaration.name);
            }
            // Breakpoint is possible in variableDeclaration only if there is initialization
            // or its declaration from 'for of'
            if ((hasOnlyExpressionInitializer(variableDeclaration) && variableDeclaration.initializer) ||
                hasSyntacticModifier(variableDeclaration, ModifierFlags.Export) ||
                (parent.parent)!.kind === SyntaxKind.ForOfStatement) {
                return textSpanFromVariableDeclaration(variableDeclaration);
            }
            if (isVariableDeclarationList(variableDeclaration.parent) &&
                variableDeclaration.parent.declarations[0] !== variableDeclaration) {
                // If we cannot set breakpoint on this declaration, set it on previous one
                // Because the variable declaration may be binding pattern and
                // we would like to set breakpoint in last binding element if that's the case,
                // use preceding token instead
                return spanInNode(findPrecedingToken(variableDeclaration.pos, sourceFile, variableDeclaration.parent));
            }
        }
        function canHaveSpanInParameterDeclaration(parameter: ParameterDeclaration): boolean {
            // Breakpoint is possible on parameter only if it has initializer, is a rest parameter, or has public or private modifier
            return !!parameter.initializer || parameter.dotDotDotToken !== undefined ||
                hasSyntacticModifier(parameter, ModifierFlags.Public | ModifierFlags.Private);
        }
        function spanInParameterDeclaration(parameter: ParameterDeclaration): TextSpan | undefined {
            if (isBindingPattern(parameter.name)) {
                // Set breakpoint in binding pattern
                return spanInBindingPattern(parameter.name);
            }
            else if (canHaveSpanInParameterDeclaration(parameter)) {
                return textSpan(parameter);
            }
            else {
                const functionDeclaration = checkedCompilerLayout(parameter.parent, checked_isFunctionLikeDeclaration);
                const indexOfParameter = functionDeclaration.parameters.indexOf(parameter);
                Debug.assert(indexOfParameter !== -1);
                if (indexOfParameter !== 0) {
                    // Not a first parameter, go to previous parameter
                    return spanInParameterDeclaration(functionDeclaration.parameters[indexOfParameter - 1]);
                }
                else {
                    // Set breakpoint in the function declaration body
                    return spanInNode(functionDeclaration.body);
                }
            }
        }
        function canFunctionHaveSpanInWholeDeclaration(functionDeclaration: FunctionLikeDeclaration) {
            return hasSyntacticModifier(functionDeclaration, ModifierFlags.Export) ||
                ((functionDeclaration.parent)!.kind === SyntaxKind.ClassDeclaration && functionDeclaration.kind !== SyntaxKind.Constructor);
        }
        function spanInFunctionDeclaration(functionDeclaration: FunctionLikeDeclaration): TextSpan | undefined {
            // No breakpoints in the function signature
            if (!functionDeclaration.body) {
                return undefined;
            }
            if (canFunctionHaveSpanInWholeDeclaration(functionDeclaration)) {
                // Set the span on whole function declaration
                return textSpan(functionDeclaration);
            }
            // Set span in function body
            return spanInNode(functionDeclaration.body);
        }
        function spanInFunctionBlock(block: Block): TextSpan | undefined {
            const nodeForSpanInBlock = block.statements.length ? block.statements[0] : requireCompilerMember(block, "getLastToken").getLastToken();
            if (canFunctionHaveSpanInWholeDeclaration((checkedCompilerLayout(block.parent, checked_isFunctionLikeDeclaration))!)) {
                return spanInNodeIfStartsOnSameLine(block.parent, nodeForSpanInBlock);
            }
            return spanInNode(nodeForSpanInBlock);
        }
        function spanInBlock(block: Block): TextSpan | undefined {
            switch ((block.parent)!.kind) {
                case SyntaxKind.ModuleDeclaration:
                    if (getModuleInstanceState((checkedCompilerLayout(block.parent, checked_isModuleDeclaration))!) !== ModuleInstanceState.Instantiated) {
                        return undefined;
                    }
                // Set on parent if on same line otherwise on first statement
                // falls through
                case SyntaxKind.WhileStatement:
                case SyntaxKind.IfStatement:
                case SyntaxKind.ForInStatement:
                    return spanInNodeIfStartsOnSameLine(block.parent, block.statements[0]);
                // Set span on previous token if it starts on same line otherwise on the first statement of the block
                case SyntaxKind.ForStatement:
                case SyntaxKind.ForOfStatement:
                    return spanInNodeIfStartsOnSameLine(findPrecedingToken(block.pos, sourceFile, block.parent), block.statements[0]);
            }
            // Default action is to set on first statement
            return spanInNode(block.statements[0]);
        }
        function spanInInitializerOfForLike(forLikeStatement: ForStatement | ForOfStatement | ForInStatement): TextSpan | undefined {
            if ((forLikeStatement.initializer)!.kind === SyntaxKind.VariableDeclarationList) {
                // Declaration list - set breakpoint in first declaration
                const variableDeclarationList = checkedCompilerLayout(forLikeStatement.initializer, checked_isVariableDeclarationList);
                if ((variableDeclarationList)!.declarations.length > 0) {
                    return spanInNode((variableDeclarationList)!.declarations[0]);
                }
            }
            else {
                // Expression - set breakpoint in it
                return spanInNode(forLikeStatement.initializer);
            }
        }
        function spanInForStatement(forStatement: ForStatement): TextSpan | undefined {
            if (forStatement.initializer) {
                return spanInInitializerOfForLike(forStatement);
            }
            if (forStatement.condition) {
                return textSpan(forStatement.condition);
            }
            if (forStatement.incrementor) {
                return textSpan(forStatement.incrementor);
            }
        }
        function spanInBindingPattern(bindingPattern: BindingPattern): TextSpan | undefined {
            // Set breakpoint in first binding element
            const firstBindingElement = forEach(bindingPattern.elements, element => element.kind !== SyntaxKind.OmittedExpression ? element : undefined);
            if (firstBindingElement) {
                return spanInNode(firstBindingElement);
            }
            // Empty binding pattern of binding element, set breakpoint on binding element
            if (bindingPattern.parent.kind === SyntaxKind.BindingElement) {
                return textSpan(bindingPattern.parent);
            }
            // Variable declaration is used as the span
            return textSpanFromVariableDeclaration(checkedCompilerLayout(bindingPattern.parent, checked_isVariableDeclaration));
        }
        function spanInArrayLiteralOrObjectLiteralDestructuringPattern(node: DestructuringPattern): TextSpan | undefined {
            Debug.assert(node.kind !== SyntaxKind.ArrayBindingPattern && node.kind !== SyntaxKind.ObjectBindingPattern);
            const elements: NodeArray<Expression | ObjectLiteralElement> = node.kind === SyntaxKind.ArrayLiteralExpression ? node.elements : node.properties;
            const firstBindingElement = forEach(elements, element => element.kind !== SyntaxKind.OmittedExpression ? element : undefined);
            if (firstBindingElement) {
                return spanInNode(firstBindingElement);
            }
            // Could be ArrayLiteral from destructuring assignment or
            // just nested element in another destructuring assignment
            // set breakpoint on assignment when parent is destructuring assignment
            // Otherwise set breakpoint for this element
            return textSpan(((node.parent)!.kind === SyntaxKind.BinaryExpression ? node.parent : node)!);
        }
        // Tokens:
        function spanInOpenBraceToken(node: Node): TextSpan | undefined {
            switch ((node.parent)!.kind) {
                case SyntaxKind.EnumDeclaration:
                    const enumDeclaration = checkedCompilerLayout(node.parent, checked_isEnumDeclaration);
                    return spanInNodeIfStartsOnSameLine(findPrecedingToken(node.pos, sourceFile, node.parent), (enumDeclaration)!.members.length ? (enumDeclaration)!.members[0] : requireCompilerMember((enumDeclaration)!, "getLastToken").getLastToken(sourceFile));
                case SyntaxKind.ClassDeclaration:
                    const classDeclaration = checkedCompilerLayout(node.parent, checked_isClassDeclaration);
                    return spanInNodeIfStartsOnSameLine(findPrecedingToken(node.pos, sourceFile, node.parent), (classDeclaration)!.members.length ? (classDeclaration)!.members[0] : requireCompilerMember((classDeclaration)!, "getLastToken").getLastToken(sourceFile));
                case SyntaxKind.CaseBlock:
                    return spanInNodeIfStartsOnSameLine((node.parent)!.parent, ((checkedCompilerLayout(node.parent, checked_isCaseBlock)))!.clauses[0]);
            }
            // Default to parent node
            return spanInNode(node.parent);
        }
        function spanInCloseBraceToken(node: Node): TextSpan | undefined {
            switch ((node.parent)!.kind) {
                case SyntaxKind.ModuleBlock:
                    // If this is not an instantiated module block, no bp span
                    if (getModuleInstanceState((checkedCompilerLayout((node.parent)!.parent, checked_isModuleDeclaration))!) !== ModuleInstanceState.Instantiated) {
                        return undefined;
                    }
                // falls through
                case SyntaxKind.EnumDeclaration:
                case SyntaxKind.ClassDeclaration:
                    // Span on close brace token
                    return textSpan(node);
                case SyntaxKind.Block:
                    if (isFunctionBlock((node.parent)!)) {
                        // Span on close brace token
                        return textSpan(node);
                    }
                // falls through
                case SyntaxKind.CatchClause:
                    return spanInNode(lastOrUndefined(((checkedCompilerLayout(node.parent, checked_isBlock)))!.statements));
                case SyntaxKind.CaseBlock:
                    // breakpoint in last statement of the last clause
                    const caseBlock = checkedCompilerLayout(node.parent, checked_isCaseBlock);
                    const lastClause = lastOrUndefined((caseBlock)!.clauses);
                    if (lastClause) {
                        return spanInNode(lastOrUndefined(lastClause.statements));
                    }
                    return undefined;
                case SyntaxKind.ObjectBindingPattern:
                    // Breakpoint in last binding element or binding pattern if it contains no elements
                    const bindingPattern = checkedCompilerLayout(node.parent, checked_isBindingPattern);
                    return spanInNode(lastOrUndefined(bindingPattern.elements) || bindingPattern);
                // Default to parent node
                default:
                    if (isArrayLiteralOrObjectLiteralDestructuringPattern((node.parent)!)) {
                        // Breakpoint in last binding element or binding pattern if it contains no elements
                        const objectLiteral = checkedCompilerLayout(node.parent, checked_isObjectLiteralExpression);
                        return textSpan((checkedCompilerLayout(lastOrUndefined((objectLiteral)!.properties), isCompilerSyntaxNode))! || objectLiteral);
                    }
                    return spanInNode(node.parent);
            }
        }
        function spanInCloseBracketToken(node: Node): TextSpan | undefined {
            switch ((node.parent)!.kind) {
                case SyntaxKind.ArrayBindingPattern:
                    // Breakpoint in last binding element or binding pattern if it contains no elements
                    const bindingPattern = checkedCompilerLayout(node.parent, checked_isBindingPattern);
                    return textSpan(lastOrUndefined(bindingPattern.elements) || bindingPattern);
                default:
                    if (isArrayLiteralOrObjectLiteralDestructuringPattern((node.parent)!)) {
                        // Breakpoint in last binding element or binding pattern if it contains no elements
                        const arrayLiteral = checkedCompilerLayout(node.parent, checked_isArrayLiteralExpression);
                        return textSpan((checkedCompilerLayout(lastOrUndefined((arrayLiteral)!.elements), isCompilerSyntaxNode))! || arrayLiteral);
                    }
                    // Default to parent node
                    return spanInNode(node.parent);
            }
        }
        function spanInOpenParenToken(node: Node): TextSpan | undefined {
            if ((node.parent)!.kind === SyntaxKind.DoStatement || // Go to while keyword and do action instead
                (node.parent)!.kind === SyntaxKind.CallExpression ||
                (node.parent)!.kind === SyntaxKind.NewExpression) {
                return spanInPreviousNode(node);
            }
            if ((node.parent)!.kind === SyntaxKind.ParenthesizedExpression) {
                return spanInNextNode(node);
            }
            // Default to parent node
            return spanInNode(node.parent);
        }
        function spanInCloseParenToken(node: Node): TextSpan | undefined {
            // Is this close paren token of parameter list, set span in previous token
            switch ((node.parent)!.kind) {
                case SyntaxKind.FunctionExpression:
                case SyntaxKind.FunctionDeclaration:
                case SyntaxKind.ArrowFunction:
                case SyntaxKind.MethodDeclaration:
                case SyntaxKind.MethodSignature:
                case SyntaxKind.GetAccessor:
                case SyntaxKind.SetAccessor:
                case SyntaxKind.Constructor:
                case SyntaxKind.WhileStatement:
                case SyntaxKind.DoStatement:
                case SyntaxKind.ForStatement:
                case SyntaxKind.ForOfStatement:
                case SyntaxKind.CallExpression:
                case SyntaxKind.NewExpression:
                case SyntaxKind.ParenthesizedExpression:
                    return spanInPreviousNode(node);
                // Default to parent node
                default:
                    return spanInNode(node.parent);
            }
        }
        function spanInColonToken(node: Node): TextSpan | undefined {
            // Is this : specifying return annotation of the function declaration
            if (isFunctionLike(node.parent) ||
                (node.parent)!.kind === SyntaxKind.PropertyAssignment ||
                (node.parent)!.kind === SyntaxKind.Parameter) {
                return spanInPreviousNode(node);
            }
            return spanInNode(node.parent);
        }
        function spanInGreaterThanOrLessThanToken(node: Node): TextSpan | undefined {
            if ((node.parent)!.kind === SyntaxKind.TypeAssertionExpression) {
                return spanInNextNode(node);
            }
            return spanInNode(node.parent);
        }
        function spanInWhileKeyword(node: Node): TextSpan | undefined {
            if ((node.parent)!.kind === SyntaxKind.DoStatement) {
                // Set span on while expression
                return textSpanEndingAtNextToken(node, ((checkedCompilerLayout(node.parent, checked_isDoStatement)))!.expression);
            }
            // Default to parent node
            return spanInNode(node.parent);
        }
        function spanInOfKeyword(node: Node): TextSpan | undefined {
            if ((node.parent)!.kind === SyntaxKind.ForOfStatement) {
                // Set using next token
                return spanInNextNode(node);
            }
            // Default to parent node
            return spanInNode(node.parent);
        }
    }
}

function isBreakpointVariable(node: Node): node is VariableDeclaration | ParameterDeclaration {
    return isVariableDeclaration(node) || isParameter(node);
}
