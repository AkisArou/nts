// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/compiler/transformers/es2017.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isNodeLayout_b74b1ef9bfcc } from "../../checkedLayouts.ts";
import { testCompilerLayout } from "../../checked.ts";
import { present } from "../../checked.ts";
import { isIdentifier as checked_isIdentifier } from "../_namespaces/ts.ts";
import { isBlock as checked_isBlock } from "../_namespaces/ts.ts";
import { isExpression as checked_isExpression } from "../_namespaces/ts.ts";
import { isPropertyAccessExpression as checked_isPropertyAccessExpression } from "../_namespaces/ts.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isAwaitExpression as checked_isAwaitExpression } from "../factory/nodeTests.ts";
import { isMethodDeclaration as checked_isMethodDeclaration } from "../factory/nodeTests.ts";
import { isFunctionDeclaration as checked_isFunctionDeclaration } from "../factory/nodeTests.ts";
import { isFunctionExpression as checked_isFunctionExpression } from "../factory/nodeTests.ts";
import { isArrowFunction as checked_isArrowFunction } from "../factory/nodeTests.ts";
import { isElementAccessExpression as checked_isElementAccessExpression } from "../factory/nodeTests.ts";
import { isGetAccessor as checked_isGetAccessor } from "../utilitiesPublic.ts";
import { isSetAccessor as checked_isSetAccessor } from "../utilitiesPublic.ts";
import { isConstructorDeclaration as checked_isConstructorDeclaration } from "../factory/nodeTests.ts";
import { isCallExpression as checked_isCallExpression } from "../factory/nodeTests.ts";
import { type __String, type AccessorDeclaration, addEmitFlags, addEmitHelper, addEmitHelpers, advancedAsyncSuperHelper, type ArrowFunction, asyncSuperHelper, type AwaitExpression, type BindingElement, type Block, type Bundle, type CallExpression, type CatchClause, chainBundle, type ClassDeclaration, type ConciseBody, type ConstructorDeclaration, Debug, type ElementAccessExpression, EmitFlags, EmitHint, type EmitResolver, type Expression, forEach, type ForInitializer, type ForInStatement, type ForOfStatement, type ForStatement, type FunctionBody, type FunctionDeclaration, type FunctionExpression, FunctionFlags, type FunctionLikeDeclaration, GeneratedIdentifierFlags, type GetAccessorDeclaration, getEmitScriptTarget, getEntityNameFromTypeNode, getFunctionFlags, getInitializedVariables, getNodeId, getOriginalNode, type Identifier, insertStatementsAfterStandardPrologue, isAwaitKeyword, isBlock, isConciseBody, isEffectiveStrictModeSourceFile, isEntityName, isExpression, isForInitializer, isFunctionLike, isFunctionLikeDeclaration, isIdentifier, isModifier, isModifierLike, isNodeWithPossibleHoistedDeclaration, isOmittedExpression, isPropertyAccessExpression, isSimpleParameterList, isStatement, isSuperProperty, isVariableDeclarationList, type LeftHandSideExpression, map, type MethodDeclaration, type Node, type NodeArray, NodeCheckFlags, type NodeFactory, NodeFlags, type ParameterDeclaration, type PropertyAccessExpression, type PropertyAssignment, ScriptTarget, type SetAccessorDeclaration, setEmitFlags, setOriginalNode, setSourceMapRange, setTextRange, type SourceFile, startOnNewLine, type Statement, SyntaxKind, type TextRange, type TransformationContext, TransformFlags, type TypeNode, TypeReferenceSerializationKind, unescapeLeadingUnderscores, type VariableDeclaration, type VariableDeclarationList, type VariableStatement, visitEachChild, visitFunctionBody, visitIterationBody, visitNode, visitNodes, visitParameterList, type VisitResult } from "../_namespaces/ts.ts";
type SuperContainer = ClassDeclaration | MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | ConstructorDeclaration;
type ES2017SubstitutionFlags = number;
const ES2017SubstitutionFlags: {
    readonly None: 0;
    readonly AsyncMethodsWithSuper: 1;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    AsyncMethodsWithSuper: 1,
    "1": "AsyncMethodsWithSuper"
};
type ContextFlags = number;
const ContextFlags: {
    readonly None: 0;
    readonly NonTopLevel: 1;
    readonly HasLexicalThis: 2;
    [index: number]: string;
} = {
    None: 0,
    "0": "None",
    NonTopLevel: 1,
    "1": "NonTopLevel",
    HasLexicalThis: 2,
    "2": "HasLexicalThis"
};
/** @internal */
export function transformES2017(context: TransformationContext): (x: SourceFile | Bundle) => SourceFile | Bundle {
    const { factory, getEmitHelperFactory: emitHelpers, resumeLexicalEnvironment, endLexicalEnvironment, hoistVariableDeclaration, } = context;
    const resolver = context.getEmitResolver();
    const compilerOptions = context.getCompilerOptions();
    const languageVersion = getEmitScriptTarget(compilerOptions);
    /**
     * Keeps track of whether expression substitution has been enabled for specific edge cases.
     * They are persisted between each SourceFile transformation and should not be reset.
     */
    let enabledSubstitutions: ES2017SubstitutionFlags = ES2017SubstitutionFlags.None;
    /**
     * This keeps track of containers where `super` is valid, for use with
     * just-in-time substitution for `super` expressions inside of async methods.
     */
    let enclosingSuperContainerFlags: NodeCheckFlags = 0;
    let enclosingFunctionParameterNames: Set<__String>;
    /**
     * Keeps track of property names accessed on super (`super.x`) within async functions.
     */
    let capturedSuperProperties: Set<__String>;
    /** Whether the async function contains an element access on super (`super[x]`). */
    let hasSuperElementAccess: boolean;
    let lexicalArgumentsBinding: Identifier | undefined;
    /** A set of node IDs for generated super accessors (variable statements). */
    const substitutedSuperAccessors: boolean[] = [];
    let contextFlags: ContextFlags = ContextFlags.None;
    // Save the previous transformation hooks.
    const previousOnEmitNode = context.onEmitNode;
    const previousOnSubstituteNode = context.onSubstituteNode;
    // Set new transformation hooks.
    context.onEmitNode = onEmitNode;
    context.onSubstituteNode = onSubstituteNode;
    return chainBundle(context, transformSourceFile);
    function transformSourceFile(node: SourceFile) {
        if (node.isDeclarationFile) {
            return node;
        }
        setContextFlag(ContextFlags.NonTopLevel, false);
        setContextFlag(ContextFlags.HasLexicalThis, !isEffectiveStrictModeSourceFile(node, compilerOptions));
        const visited = visitEachChild(node, visitor, context);
        addEmitHelpers(visited, context.readEmitHelpers());
        return visited;
    }
    function setContextFlag(flag: ContextFlags, val: boolean) {
        contextFlags = val ? contextFlags | flag : contextFlags & ~flag;
    }
    function inContext(flags: ContextFlags) {
        return (contextFlags & flags) !== 0;
    }
    function inTopLevelContext() {
        return !inContext(ContextFlags.NonTopLevel);
    }
    function inHasLexicalThisContext() {
        return inContext(ContextFlags.HasLexicalThis);
    }
    function doWithContext<T, U>(flags: ContextFlags, cb: (value: T) => U, value: T) {
        const contextFlagsToSet = flags & ~contextFlags;
        if (contextFlagsToSet) {
            setContextFlag(contextFlagsToSet, /*val*/ true);
            const result = cb(value);
            setContextFlag(contextFlagsToSet, /*val*/ false);
            return result;
        }
        return cb(value);
    }
    function visitDefault(node: Node): VisitResult<Node> {
        return visitEachChild(node, visitor, context);
    }
    function argumentsVisitor(node: Node): VisitResult<Node> {
        switch (node.kind) {
            case SyntaxKind.FunctionExpression:
            case SyntaxKind.FunctionDeclaration:
            case SyntaxKind.MethodDeclaration:
            case SyntaxKind.GetAccessor:
            case SyntaxKind.SetAccessor:
            case SyntaxKind.Constructor:
                return node;
            case SyntaxKind.Parameter:
            case SyntaxKind.BindingElement:
            case SyntaxKind.VariableDeclaration:
                break;
            case SyntaxKind.Identifier:
                if (lexicalArgumentsBinding && resolver.isArgumentsLocalBinding(checkedCompilerLayout(node, checked_isIdentifier))) {
                    return lexicalArgumentsBinding;
                }
                break;
        }
        return visitEachChild(node, argumentsVisitor, context);
    }
    function visitor(node: Node): VisitResult<Node | undefined> {
        if ((node.transformFlags & TransformFlags.ContainsES2017) === 0) {
            return lexicalArgumentsBinding ? argumentsVisitor(node) : node;
        }
        switch (node.kind) {
            case SyntaxKind.AsyncKeyword:
                // ES2017 async modifier should be elided for targets < ES2017
                return undefined;
            case SyntaxKind.AwaitExpression:
                return visitAwaitExpression(checkedCompilerLayout(node, checked_isAwaitExpression));
            case SyntaxKind.MethodDeclaration:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitMethodDeclaration, checkedCompilerLayout(node, checked_isMethodDeclaration));
            case SyntaxKind.FunctionDeclaration:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitFunctionDeclaration, checkedCompilerLayout(node, checked_isFunctionDeclaration));
            case SyntaxKind.FunctionExpression:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitFunctionExpression, checkedCompilerLayout(node, checked_isFunctionExpression));
            case SyntaxKind.ArrowFunction:
                return doWithContext(ContextFlags.NonTopLevel, visitArrowFunction, checkedCompilerLayout(node, checked_isArrowFunction));
            case SyntaxKind.PropertyAccessExpression:
                if (capturedSuperProperties && isPropertyAccessExpression(node) && node.expression.kind === SyntaxKind.SuperKeyword) {
                    capturedSuperProperties.add(node.name.escapedText);
                }
                return visitEachChild(node, visitor, context);
            case SyntaxKind.ElementAccessExpression:
                if (capturedSuperProperties && (checkedCompilerLayout(node, checked_isElementAccessExpression)).expression.kind === SyntaxKind.SuperKeyword) {
                    hasSuperElementAccess = true;
                }
                return visitEachChild(node, visitor, context);
            case SyntaxKind.GetAccessor:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitGetAccessorDeclaration, checkedCompilerLayout(node, checked_isGetAccessor));
            case SyntaxKind.SetAccessor:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitSetAccessorDeclaration, checkedCompilerLayout(node, checked_isSetAccessor));
            case SyntaxKind.Constructor:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitConstructorDeclaration, checkedCompilerLayout(node, checked_isConstructorDeclaration));
            case SyntaxKind.ClassDeclaration:
            case SyntaxKind.ClassExpression:
                return doWithContext(ContextFlags.NonTopLevel | ContextFlags.HasLexicalThis, visitDefault, node);
            default:
                return visitEachChild(node, visitor, context);
        }
    }
    function asyncBodyVisitor(node: Node): VisitResult<Node | undefined> {
        if (isNodeWithPossibleHoistedDeclaration(node)) {
            switch (node.kind) {
                case SyntaxKind.VariableStatement:
                    return visitVariableStatementInAsyncBody(node);
                case SyntaxKind.ForStatement:
                    return visitForStatementInAsyncBody(node);
                case SyntaxKind.ForInStatement:
                    return visitForInStatementInAsyncBody(node);
                case SyntaxKind.ForOfStatement:
                    return visitForOfStatementInAsyncBody(node);
                case SyntaxKind.CatchClause:
                    return visitCatchClauseInAsyncBody(node);
                case SyntaxKind.Block:
                case SyntaxKind.SwitchStatement:
                case SyntaxKind.CaseBlock:
                case SyntaxKind.CaseClause:
                case SyntaxKind.DefaultClause:
                case SyntaxKind.TryStatement:
                case SyntaxKind.DoStatement:
                case SyntaxKind.WhileStatement:
                case SyntaxKind.IfStatement:
                case SyntaxKind.WithStatement:
                case SyntaxKind.LabeledStatement:
                    return visitEachChild(node, asyncBodyVisitor, context);
                default:
                    return Debug.assertNever(node, "Unhandled node.");
            }
        }
        return visitor(node);
    }
    function visitCatchClauseInAsyncBody(node: CatchClause) {
        const catchClauseNames = new Set<__String>();
        recordDeclarationName((node.variableDeclaration)!, catchClauseNames); // TODO: GH#18217
        // names declared in a catch variable are block scoped
        let catchClauseUnshadowedNames: Set<__String> | undefined;
        catchClauseNames.forEach((_, escapedName) => {
            if (enclosingFunctionParameterNames.has(escapedName)) {
                if (!catchClauseUnshadowedNames) {
                    catchClauseUnshadowedNames = new Set(enclosingFunctionParameterNames);
                }
                catchClauseUnshadowedNames.delete(escapedName);
            }
        });
        if (catchClauseUnshadowedNames) {
            const savedEnclosingFunctionParameterNames = enclosingFunctionParameterNames;
            enclosingFunctionParameterNames = catchClauseUnshadowedNames;
            const result = visitEachChild(node, asyncBodyVisitor, context);
            enclosingFunctionParameterNames = savedEnclosingFunctionParameterNames;
            return result;
        }
        else {
            return visitEachChild(node, asyncBodyVisitor, context);
        }
    }
    function visitVariableStatementInAsyncBody(node: VariableStatement) {
        if (isVariableDeclarationListWithCollidingName(node.declarationList)) {
            const expression = visitVariableDeclarationListWithCollidingNames(node.declarationList, /*hasReceiver*/ false);
            return expression ? factory.createExpressionStatement(expression) : undefined;
        }
        return visitEachChild(node, visitor, context);
    }
    function visitForInStatementInAsyncBody(node: ForInStatement) {
        return factory.updateForInStatement(node, (isVariableDeclarationListWithCollidingName(node.initializer)
            ? visitVariableDeclarationListWithCollidingNames(node.initializer, /*hasReceiver*/ true)
            : Debug.checkDefined(visitNode(node.initializer, visitor, isForInitializer)))!, Debug.checkDefined(visitNode(node.expression, visitor, isExpression)), visitIterationBody(node.statement, asyncBodyVisitor, context));
    }
    function visitForOfStatementInAsyncBody(node: ForOfStatement) {
        return factory.updateForOfStatement(node, visitNode(node.awaitModifier, visitor, isAwaitKeyword), (isVariableDeclarationListWithCollidingName(node.initializer)
            ? visitVariableDeclarationListWithCollidingNames(node.initializer, /*hasReceiver*/ true)
            : Debug.checkDefined(visitNode(node.initializer, visitor, isForInitializer)))!, Debug.checkDefined(visitNode(node.expression, visitor, isExpression)), visitIterationBody(node.statement, asyncBodyVisitor, context));
    }
    function visitForStatementInAsyncBody(node: ForStatement) {
        const initializer = node.initializer; // TODO: GH#18217
        return factory.updateForStatement(node, testCompilerLayout(initializer, isVariableDeclarationListWithCollidingName) ? visitVariableDeclarationListWithCollidingNames(initializer, /*hasReceiver*/ false)
            : visitNode(node.initializer, visitor, isForInitializer), visitNode(node.condition, visitor, isExpression), visitNode(node.incrementor, visitor, isExpression), visitIterationBody(node.statement, asyncBodyVisitor, context));
    }
    /**
     * Visits an AwaitExpression node.
     *
     * This function will be called any time a ES2017 await expression is encountered.
     *
     * @param node The node to visit.
     */
    function visitAwaitExpression(node: AwaitExpression): Expression {
        // do not downlevel a top-level await as it is module syntax...
        if (inTopLevelContext()) {
            return visitEachChild(node, visitor, context);
        }
        return setOriginalNode(setTextRange(factory.createYieldExpression(
        /*asteriskToken*/ undefined, visitNode(node.expression, visitor, isExpression)), node), node);
    }
    function visitConstructorDeclaration(node: ConstructorDeclaration) {
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        lexicalArgumentsBinding = undefined;
        const updated = factory.updateConstructorDeclaration(node, visitNodes(node.modifiers, visitor, isModifier), visitParameterList(node.parameters, visitor, context), transformMethodBody(node));
        lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        return updated;
    }
    /**
     * Visits a MethodDeclaration node.
     *
     * This function will be called when one of the following conditions are met:
     * - The node is marked as async
     *
     * @param node The node to visit.
     */
    function visitMethodDeclaration(node: MethodDeclaration) {
        let parameters: NodeArray<ParameterDeclaration>;
        const functionFlags = getFunctionFlags(node);
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        lexicalArgumentsBinding = undefined;
        const updated = factory.updateMethodDeclaration(node, visitNodes(node.modifiers, visitor, isModifierLike), node.asteriskToken, node.name, 
        /*questionToken*/ undefined, 
        /*typeParameters*/ undefined, parameters = functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionParameterList(node) :
            visitParameterList(node.parameters, visitor, context), 
        /*type*/ undefined, functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionBody(node, parameters) :
            transformMethodBody(node));
        lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        return updated;
    }
    function visitGetAccessorDeclaration(node: GetAccessorDeclaration) {
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        lexicalArgumentsBinding = undefined;
        const updated = factory.updateGetAccessorDeclaration(node, visitNodes(node.modifiers, visitor, isModifierLike), node.name, visitParameterList(node.parameters, visitor, context), 
        /*type*/ undefined, transformMethodBody(node));
        lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        return updated;
    }
    function visitSetAccessorDeclaration(node: SetAccessorDeclaration) {
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        lexicalArgumentsBinding = undefined;
        const updated = factory.updateSetAccessorDeclaration(node, visitNodes(node.modifiers, visitor, isModifierLike), node.name, visitParameterList(node.parameters, visitor, context), transformMethodBody(node));
        lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        return updated;
    }
    /**
     * Visits a FunctionDeclaration node.
     *
     * This function will be called when one of the following conditions are met:
     * - The node is marked async
     *
     * @param node The node to visit.
     */
    function visitFunctionDeclaration(node: FunctionDeclaration): VisitResult<Statement> {
        let parameters: NodeArray<ParameterDeclaration>;
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        lexicalArgumentsBinding = undefined;
        const functionFlags = getFunctionFlags(node);
        const updated = factory.updateFunctionDeclaration(node, visitNodes(node.modifiers, visitor, isModifierLike), node.asteriskToken, node.name, 
        /*typeParameters*/ undefined, parameters = functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionParameterList(node) :
            visitParameterList(node.parameters, visitor, context), 
        /*type*/ undefined, functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionBody(node, parameters) :
            visitFunctionBody(node.body, visitor, context));
        lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        return updated;
    }
    /**
     * Visits a FunctionExpression node.
     *
     * This function will be called when one of the following conditions are met:
     * - The node is marked async
     *
     * @param node The node to visit.
     */
    function visitFunctionExpression(node: FunctionExpression): Expression {
        let parameters: NodeArray<ParameterDeclaration>;
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        lexicalArgumentsBinding = undefined;
        const functionFlags = getFunctionFlags(node);
        const updated = factory.updateFunctionExpression(node, visitNodes(node.modifiers, visitor, isModifier), node.asteriskToken, node.name, 
        /*typeParameters*/ undefined, parameters = functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionParameterList(node) :
            visitParameterList(node.parameters, visitor, context), 
        /*type*/ undefined, functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionBody(node, parameters) :
            visitFunctionBody(node.body, visitor, context));
        lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        return updated;
    }
    /**
     * Visits an ArrowFunction.
     *
     * This function will be called when one of the following conditions are met:
     * - The node is marked async
     *
     * @param node The node to visit.
     */
    function visitArrowFunction(node: ArrowFunction) {
        let parameters: NodeArray<ParameterDeclaration>;
        const functionFlags = getFunctionFlags(node);
        return factory.updateArrowFunction(node, visitNodes(node.modifiers, visitor, isModifier), 
        /*typeParameters*/ undefined, parameters = functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionParameterList(node) :
            visitParameterList(node.parameters, visitor, context), 
        /*type*/ undefined, node.equalsGreaterThanToken, functionFlags & FunctionFlags.Async ?
            transformAsyncFunctionBody(node, parameters) :
            visitFunctionBody(node.body, visitor, context));
    }
    function recordDeclarationName({ name }: ParameterDeclaration | VariableDeclaration | BindingElement, names: Set<__String>) {
        if (isIdentifier(name)) {
            names.add(name.escapedText);
        }
        else {
            for (const element of name.elements) {
                if (!isOmittedExpression(element)) {
                    recordDeclarationName(element, names);
                }
            }
        }
    }
    function isVariableDeclarationListWithCollidingName(node: ForInitializer): node is VariableDeclarationList {
        return !!node
            && isVariableDeclarationList(node)
            && !(node.flags & NodeFlags.BlockScoped)
            && node.declarations.some(collidesWithParameterName);
    }
    function visitVariableDeclarationListWithCollidingNames(node: VariableDeclarationList, hasReceiver: boolean) {
        hoistVariableDeclarationList(node);
        const variables = getInitializedVariables(node);
        if (variables.length === 0) {
            if (hasReceiver) {
                return visitNode(factory.converters.convertToAssignmentElementTarget(node.declarations[0].name), visitor, isExpression);
            }
            return undefined;
        }
        return factory.inlineExpressions(map(variables, transformInitializedVariable));
    }
    function hoistVariableDeclarationList(node: VariableDeclarationList) {
        forEach(node.declarations, hoistVariable);
    }
    function hoistVariable({ name }: VariableDeclaration | BindingElement) {
        if (isIdentifier(name)) {
            hoistVariableDeclaration(name);
        }
        else {
            for (const element of name.elements) {
                if (!isOmittedExpression(element)) {
                    hoistVariable(element);
                }
            }
        }
    }
    function transformInitializedVariable(node: VariableDeclaration) {
        const converted = setSourceMapRange(factory.createAssignment(factory.converters.convertToAssignmentElementTarget(node.name), node.initializer!), node);
        return Debug.checkDefined(visitNode(converted, visitor, isExpression));
    }
    function collidesWithParameterName({ name }: VariableDeclaration | BindingElement): boolean {
        if (isIdentifier(name)) {
            return enclosingFunctionParameterNames.has(name.escapedText);
        }
        else {
            for (const element of name.elements) {
                if (!isOmittedExpression(element) && collidesWithParameterName(element)) {
                    return true;
                }
            }
        }
        return false;
    }
    function transformMethodBody(node: MethodDeclaration | AccessorDeclaration | ConstructorDeclaration): FunctionBody | undefined {
        Debug.assertIsDefined(node.body);
        const savedCapturedSuperProperties = capturedSuperProperties;
        const savedHasSuperElementAccess = hasSuperElementAccess;
        capturedSuperProperties = new Set();
        hasSuperElementAccess = false;
        let updated = visitFunctionBody(node.body, visitor, context);
        // Minor optimization, emit `_super` helper to capture `super` access in an arrow.
        // This step isn't needed if we eventually transform this to ES5.
        const originalMethod = getOriginalNode(node, isFunctionLikeDeclaration);
        const emitSuperHelpers = languageVersion >= ScriptTarget.ES2015 &&
            (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync) || resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAccessInAsync)) &&
            (getFunctionFlags(checkedCompilerLayout(originalMethod, isNodeLayout_b74b1ef9bfcc)) & FunctionFlags.AsyncGenerator) !== FunctionFlags.AsyncGenerator;
        if (emitSuperHelpers) {
            enableSubstitutionForAsyncMethodsWithSuper();
            if (capturedSuperProperties.size) {
                const variableStatement = createSuperAccessVariableStatement(factory, resolver, node, capturedSuperProperties);
                substitutedSuperAccessors[getNodeId(variableStatement)] = true;
                const statements = updated.statements.slice();
                insertStatementsAfterStandardPrologue(statements, [variableStatement]);
                updated = factory.updateBlock(updated, statements);
            }
            if (hasSuperElementAccess) {
                // Emit helpers for super element access expressions (`super[x]`).
                if (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync)) {
                    addEmitHelper(updated, advancedAsyncSuperHelper);
                }
                else if (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAccessInAsync)) {
                    addEmitHelper(updated, asyncSuperHelper);
                }
            }
        }
        capturedSuperProperties = savedCapturedSuperProperties;
        hasSuperElementAccess = savedHasSuperElementAccess;
        return updated;
    }
    function createCaptureArgumentsStatement() {
        Debug.assert(lexicalArgumentsBinding);
        const variable = factory.createVariableDeclaration(lexicalArgumentsBinding, /*exclamationToken*/ undefined, /*type*/ undefined, factory.createIdentifier("arguments"));
        const statement = factory.createVariableStatement(/*modifiers*/ undefined, [variable]);
        startOnNewLine(statement);
        addEmitFlags(statement, EmitFlags.CustomPrologue);
        return statement;
    }
    function transformAsyncFunctionParameterList(node: FunctionLikeDeclaration) {
        if (isSimpleParameterList(node.parameters)) {
            return visitParameterList(node.parameters, visitor, context);
        }
        const newParameters: ParameterDeclaration[] = [];
        for (const parameter of node.parameters) {
            if (parameter.initializer || parameter.dotDotDotToken) {
                // for an arrow function, capture the remaining arguments in a rest parameter.
                // for any other function/method this isn't necessary as we can just use `arguments`.
                if (node.kind === SyntaxKind.ArrowFunction) {
                    const restParameter = factory.createParameterDeclaration(
                    /*modifiers*/ undefined, factory.createToken(SyntaxKind.DotDotDotToken), factory.createUniqueName("args", GeneratedIdentifierFlags.ReservedInNestedScopes));
                    newParameters.push(restParameter);
                }
                break;
            }
            // for arrow functions we capture fixed parameters to forward to `__awaiter`. For all other functions
            // we add fixed parameters to preserve the function's `length` property.
            const newParameter = factory.createParameterDeclaration(
            /*modifiers*/ undefined, 
            /*dotDotDotToken*/ undefined, factory.getGeneratedNameForNode(parameter.name, GeneratedIdentifierFlags.ReservedInNestedScopes));
            newParameters.push(newParameter);
        }
        const newParametersArray = factory.createNodeArray(newParameters);
        setTextRange(newParametersArray, node.parameters);
        return newParametersArray;
    }
    function transformAsyncFunctionBody(node: MethodDeclaration | AccessorDeclaration | FunctionDeclaration | FunctionExpression, outerParameters: NodeArray<ParameterDeclaration>): FunctionBody;
    function transformAsyncFunctionBody(node: ArrowFunction, outerParameters: NodeArray<ParameterDeclaration>): ConciseBody;
    function transformAsyncFunctionBody(node: FunctionLikeDeclaration, outerParameters: NodeArray<ParameterDeclaration>): ConciseBody {
        const innerParameters = !isSimpleParameterList(node.parameters) ? visitParameterList(node.parameters, visitor, context) : undefined;
        resumeLexicalEnvironment();
        const original = getOriginalNode(node, isFunctionLike);
        const nodeType = original.type;
        const promiseConstructor = languageVersion < ScriptTarget.ES2015 ? getPromiseConstructor(nodeType) : undefined;
        const isArrowFunction = node.kind === SyntaxKind.ArrowFunction;
        const savedLexicalArgumentsBinding = lexicalArgumentsBinding;
        const hasLexicalArguments = resolver.hasNodeCheckFlag(node, NodeCheckFlags.CaptureArguments);
        const captureLexicalArguments = hasLexicalArguments && !lexicalArgumentsBinding;
        if (captureLexicalArguments) {
            lexicalArgumentsBinding = factory.createUniqueName("arguments");
        }
        let argumentsExpression: Expression | undefined;
        if (innerParameters) {
            if (isArrowFunction) {
                // `node` does not have a simple parameter list, so `outerParameters` refers to placeholders that are
                // forwarded to `innerParameters`, matching how they are introduced in `transformAsyncFunctionParameterList`.
                const parameterBindings: Expression[] = [];
                Debug.assert(outerParameters.length <= node.parameters.length);
                for (let i = 0; i < node.parameters.length; i++) {
                    Debug.assert(i < outerParameters.length);
                    const originalParameter = node.parameters[i];
                    const outerParameter = outerParameters[i];
                    Debug.assertNode(outerParameter.name, isIdentifier);
                    if (originalParameter.initializer || originalParameter.dotDotDotToken) {
                        Debug.assert(i === outerParameters.length - 1);
                        parameterBindings.push(factory.createSpreadElement(outerParameter.name));
                        break;
                    }
                    parameterBindings.push(outerParameter.name);
                }
                argumentsExpression = factory.createArrayLiteralExpression(parameterBindings);
            }
            else {
                argumentsExpression = factory.createIdentifier("arguments");
            }
        }
        // An async function is emit as an outer function that calls an inner
        // generator function. To preserve lexical bindings, we pass the current
        // `this` and `arguments` objects to `__awaiter`. The generator function
        // passed to `__awaiter` is executed inside of the callback to the
        // promise constructor.
        const savedEnclosingFunctionParameterNames = enclosingFunctionParameterNames;
        enclosingFunctionParameterNames = new Set();
        for (const parameter of node.parameters) {
            recordDeclarationName(parameter, enclosingFunctionParameterNames);
        }
        const savedCapturedSuperProperties = capturedSuperProperties;
        const savedHasSuperElementAccess = hasSuperElementAccess;
        if (!isArrowFunction) {
            capturedSuperProperties = new Set();
            hasSuperElementAccess = false;
        }
        const hasLexicalThis = inHasLexicalThisContext();
        let asyncBody = transformAsyncFunctionBodyWorker((checkedCompilerLayout(node.body, checked_isBlock))!);
        asyncBody = factory.updateBlock(asyncBody, factory.mergeLexicalEnvironment(asyncBody.statements, endLexicalEnvironment()));
        let result: ConciseBody;
        if (!isArrowFunction) {
            const statements: Statement[] = [];
            statements.push(factory.createReturnStatement(emitHelpers().createAwaiterHelper(hasLexicalThis, argumentsExpression, promiseConstructor, innerParameters, asyncBody)));
            // Minor optimization, emit `_super` helper to capture `super` access in an arrow.
            // This step isn't needed if we eventually transform this to ES5.
            const emitSuperHelpers = languageVersion >= ScriptTarget.ES2015 && (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync) || resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAccessInAsync));
            if (emitSuperHelpers) {
                enableSubstitutionForAsyncMethodsWithSuper();
                if (capturedSuperProperties.size) {
                    const variableStatement = createSuperAccessVariableStatement(factory, resolver, node, capturedSuperProperties);
                    substitutedSuperAccessors[getNodeId(variableStatement)] = true;
                    insertStatementsAfterStandardPrologue(statements, [variableStatement]);
                }
            }
            if (captureLexicalArguments) {
                insertStatementsAfterStandardPrologue(statements, [createCaptureArgumentsStatement()]);
            }
            const block = factory.createBlock(statements, /*multiLine*/ true);
            setTextRange(block, node.body);
            if (emitSuperHelpers && hasSuperElementAccess) {
                // Emit helpers for super element access expressions (`super[x]`).
                if (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync)) {
                    addEmitHelper(block, advancedAsyncSuperHelper);
                }
                else if (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAccessInAsync)) {
                    addEmitHelper(block, asyncSuperHelper);
                }
            }
            result = block;
        }
        else {
            result = emitHelpers().createAwaiterHelper(hasLexicalThis, argumentsExpression, promiseConstructor, innerParameters, asyncBody);
            if (captureLexicalArguments) {
                const block = factory.converters.convertToFunctionBlock(result);
                result = factory.updateBlock(block, factory.mergeLexicalEnvironment(block.statements, [createCaptureArgumentsStatement()]));
            }
        }
        enclosingFunctionParameterNames = savedEnclosingFunctionParameterNames;
        if (!isArrowFunction) {
            capturedSuperProperties = savedCapturedSuperProperties;
            hasSuperElementAccess = savedHasSuperElementAccess;
            lexicalArgumentsBinding = savedLexicalArgumentsBinding;
        }
        return result;
    }
    function transformAsyncFunctionBodyWorker(body: ConciseBody, start?: number) {
        if (isBlock(body)) {
            return factory.updateBlock(body, visitNodes(body.statements, asyncBodyVisitor, isStatement, start));
        }
        else {
            return factory.converters.convertToFunctionBlock(Debug.checkDefined(visitNode(body, asyncBodyVisitor, isConciseBody)));
        }
    }
    function getPromiseConstructor(type: TypeNode | undefined) {
        const typeName = type && getEntityNameFromTypeNode(type);
        if (typeName && isEntityName(typeName)) {
            const serializationKind = resolver.getTypeReferenceSerializationKind(typeName);
            if (serializationKind === TypeReferenceSerializationKind.TypeWithConstructSignatureAndValue
                || serializationKind === TypeReferenceSerializationKind.Unknown) {
                return typeName;
            }
        }
        return undefined;
    }
    function enableSubstitutionForAsyncMethodsWithSuper() {
        if ((enabledSubstitutions & ES2017SubstitutionFlags.AsyncMethodsWithSuper) === 0) {
            enabledSubstitutions |= ES2017SubstitutionFlags.AsyncMethodsWithSuper;
            // We need to enable substitutions for call, property access, and element access
            // if we need to rewrite super calls.
            context.enableSubstitution(SyntaxKind.CallExpression);
            context.enableSubstitution(SyntaxKind.PropertyAccessExpression);
            context.enableSubstitution(SyntaxKind.ElementAccessExpression);
            // We need to be notified when entering and exiting declarations that bind super.
            context.enableEmitNotification(SyntaxKind.ClassDeclaration);
            context.enableEmitNotification(SyntaxKind.MethodDeclaration);
            context.enableEmitNotification(SyntaxKind.GetAccessor);
            context.enableEmitNotification(SyntaxKind.SetAccessor);
            context.enableEmitNotification(SyntaxKind.Constructor);
            // We need to be notified when entering the generated accessor arrow functions.
            context.enableEmitNotification(SyntaxKind.VariableStatement);
        }
    }
    /**
     * Hook for node emit.
     *
     * @param hint A hint as to the intended usage of the node.
     * @param node The node to emit.
     * @param emit A callback used to emit the node in the printer.
     */
    function onEmitNode(hint: EmitHint, node: Node, emitCallback: (hint: EmitHint, node: Node) => void): void {
        // If we need to support substitutions for `super` in an async method,
        // we should track it here.
        if (enabledSubstitutions & ES2017SubstitutionFlags.AsyncMethodsWithSuper && isSuperContainer(node)) {
            const superContainerFlags = (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAccessInAsync) ? NodeCheckFlags.MethodWithSuperPropertyAccessInAsync : 0) | (resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync) ? NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync : 0);
            if (superContainerFlags !== enclosingSuperContainerFlags) {
                const savedEnclosingSuperContainerFlags = enclosingSuperContainerFlags;
                enclosingSuperContainerFlags = superContainerFlags;
                previousOnEmitNode(hint, node, emitCallback);
                enclosingSuperContainerFlags = savedEnclosingSuperContainerFlags;
                return;
            }
        }
        // Disable substitution in the generated super accessor itself.
        else if (enabledSubstitutions && substitutedSuperAccessors[getNodeId(node)]) {
            const savedEnclosingSuperContainerFlags = enclosingSuperContainerFlags;
            enclosingSuperContainerFlags = 0;
            previousOnEmitNode(hint, node, emitCallback);
            enclosingSuperContainerFlags = savedEnclosingSuperContainerFlags;
            return;
        }
        previousOnEmitNode(hint, node, emitCallback);
    }
    /**
     * Hooks node substitutions.
     *
     * @param hint A hint as to the intended usage of the node.
     * @param node The node to substitute.
     */
    function onSubstituteNode(hint: EmitHint, node: Node) {
        node = previousOnSubstituteNode(hint, node);
        if (hint === EmitHint.Expression && enclosingSuperContainerFlags) {
            return substituteExpression((node));
        }
        return node;
    }
    function substituteExpression(node: Expression) {
        switch (node.kind) {
            case SyntaxKind.PropertyAccessExpression:
                return substitutePropertyAccessExpression(checkedCompilerLayout(node, checked_isPropertyAccessExpression));
            case SyntaxKind.ElementAccessExpression:
                return substituteElementAccessExpression(checkedCompilerLayout(node, checked_isElementAccessExpression));
            case SyntaxKind.CallExpression:
                return substituteCallExpression(checkedCompilerLayout(node, checked_isCallExpression));
        }
        return node;
    }
    function substitutePropertyAccessExpression(node: PropertyAccessExpression) {
        if (node.expression.kind === SyntaxKind.SuperKeyword) {
            return setTextRange(factory.createPropertyAccessExpression(factory.createUniqueName("_super", GeneratedIdentifierFlags.Optimistic | GeneratedIdentifierFlags.FileLevel), node.name), node);
        }
        return node;
    }
    function substituteElementAccessExpression(node: ElementAccessExpression) {
        if (node.expression.kind === SyntaxKind.SuperKeyword) {
            return createSuperElementAccessInAsyncMethod(node.argumentExpression, node);
        }
        return node;
    }
    function substituteCallExpression(node: CallExpression): Expression {
        const expression = node.expression;
        if (isSuperProperty(expression)) {
            const argumentExpression = isPropertyAccessExpression(expression)
                ? substitutePropertyAccessExpression(expression)
                : substituteElementAccessExpression(expression);
            return factory.createCallExpression(factory.createPropertyAccessExpression(argumentExpression, "call"), 
            /*typeArguments*/ undefined, [
                factory.createThis(),
                ...node.arguments,
            ]);
        }
        return node;
    }
    function isSuperContainer(node: Node): node is SuperContainer {
        const kind = node.kind;
        return kind === SyntaxKind.ClassDeclaration
            || kind === SyntaxKind.Constructor
            || kind === SyntaxKind.MethodDeclaration
            || kind === SyntaxKind.GetAccessor
            || kind === SyntaxKind.SetAccessor;
    }
    function createSuperElementAccessInAsyncMethod(argumentExpression: Expression, location: TextRange): LeftHandSideExpression {
        if (enclosingSuperContainerFlags & NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync) {
            return setTextRange(factory.createPropertyAccessExpression(factory.createCallExpression(factory.createUniqueName("_superIndex", GeneratedIdentifierFlags.Optimistic | GeneratedIdentifierFlags.FileLevel), 
            /*typeArguments*/ undefined, [argumentExpression]), "value"), location);
        }
        else {
            return setTextRange(factory.createCallExpression(factory.createUniqueName("_superIndex", GeneratedIdentifierFlags.Optimistic | GeneratedIdentifierFlags.FileLevel), 
            /*typeArguments*/ undefined, [argumentExpression]), location);
        }
    }
}
/**
 * Creates a variable named `_super` with accessor properties for the given property names.
 *
 * @internal
 */
export function createSuperAccessVariableStatement(factory: NodeFactory, resolver: EmitResolver, node: FunctionLikeDeclaration, names: Set<__String>): VariableStatement {
    // Create a variable declaration with a getter/setter (if binding) definition for each name:
    //   const _super = Object.create(null, { x: { get: () => super.x, set: (v) => super.x = v }, ... });
    const hasBinding = resolver.hasNodeCheckFlag(node, NodeCheckFlags.MethodWithSuperPropertyAssignmentInAsync);
    const accessors: PropertyAssignment[] = [];
    names.forEach((_, key) => {
        const name = unescapeLeadingUnderscores(key);
        const getterAndSetter: PropertyAssignment[] = [];
        getterAndSetter.push(factory.createPropertyAssignment("get", factory.createArrowFunction(
        /*modifiers*/ undefined, 
        /*typeParameters*/ undefined, 
        /* parameters */ [], 
        /*type*/ undefined, 
        /*equalsGreaterThanToken*/ undefined, setEmitFlags(factory.createPropertyAccessExpression(setEmitFlags(factory.createSuper(), EmitFlags.NoSubstitution), name), EmitFlags.NoSubstitution))));
        if (hasBinding) {
            getterAndSetter.push(factory.createPropertyAssignment("set", factory.createArrowFunction(
            /*modifiers*/ undefined, 
            /*typeParameters*/ undefined, 
            /* parameters */ [
                factory.createParameterDeclaration(
                /*modifiers*/ undefined, 
                /*dotDotDotToken*/ undefined, "v", 
                /*questionToken*/ undefined, 
                /*type*/ undefined, 
                /*initializer*/ undefined),
            ], 
            /*type*/ undefined, 
            /*equalsGreaterThanToken*/ undefined, factory.createAssignment(setEmitFlags(factory.createPropertyAccessExpression(setEmitFlags(factory.createSuper(), EmitFlags.NoSubstitution), name), EmitFlags.NoSubstitution), factory.createIdentifier("v")))));
        }
        accessors.push(factory.createPropertyAssignment(name, factory.createObjectLiteralExpression(getterAndSetter)));
    });
    return factory.createVariableStatement(
    /*modifiers*/ undefined, factory.createVariableDeclarationList([
        factory.createVariableDeclaration(factory.createUniqueName("_super", GeneratedIdentifierFlags.Optimistic | GeneratedIdentifierFlags.FileLevel), 
        /*exclamationToken*/ undefined, 
        /*type*/ undefined, factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "create"), 
        /*typeArguments*/ undefined, [
            factory.createNull(),
            factory.createObjectLiteralExpression(accessors, /*multiLine*/ true),
        ])),
    ], NodeFlags.Const));
}
