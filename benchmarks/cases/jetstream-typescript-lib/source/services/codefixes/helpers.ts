// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/helpers.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import { isCompilerUnionOrIntersectionType } from "../../checkedTypes.ts";
import { isCompilerSyntaxNode } from "../../checkedTypes.ts";
import { testCompilerMethod_isUnion, testCompilerMethod_isUnionOrIntersection, testCompilerMethod_isTypeParameter } from "../../checkedMethods.ts";
import { requireCompilerMember } from "../../checked.ts";
import { isNodeLayout_b74b1ef9bfcc } from "../../checkedLayouts.ts";
import { testCompilerLayout } from "../../checked.ts";
import { isMethodDeclaration as checked_isMethodDeclaration } from "../_namespaces/ts.ts";
import { present } from "../../checked.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { isAccessor as checked_isAccessor } from "../../compiler/utilitiesPublic.ts";
import { isTransientSymbol as checked_isTransientSymbol } from "../../compiler/utilities.ts";
import { isPropertyName as checked_isPropertyName } from "../../compiler/utilitiesPublic.ts";
import { isCompilerGenericType as checked_isCompilerGenericType } from "../../checkedTypes.ts";
import { isCompilerObjectType as checked_isCompilerObjectType } from "../../checkedTypes.ts";
import { type ImportAdder } from "../_namespaces/ts.codefix.ts";
import { type AccessorDeclaration, append, arrayFrom, type ArrowFunction, type Block, type CallExpression, CharacterCodes, CheckFlags, type ClassLikeDeclaration, type CodeFixContextBase, combine, Debug, type Declaration, Diagnostics, emptyArray, type EntityName, type Expression, factory, find, firstOrUndefined, flatMap, type FunctionDeclaration, type FunctionExpression, type GenericType, type GetAccessorDeclaration, getAllAccessorDeclarations, getCheckFlags, getEffectiveModifierFlags, getEmitScriptTarget, getFirstIdentifier, getModuleSpecifierResolverHost, getNameForExportedSymbol, getNameOfDeclaration, getPropertyNameFromType, getQuotePreference, getSetAccessorValueParameter, getSynthesizedDeepClone, getTokenAtPosition, getTsConfigObjectLiteralExpression, hasAbstractModifier, type Identifier, idText, InternalNodeBuilderFlags, type IntersectionType, isArrowFunction, isAutoAccessorPropertyDeclaration, isFunctionDeclaration, isFunctionExpression, isGetAccessorDeclaration, isIdentifier, isImportTypeNode, isInJSFile, isLiteralImportTypeNode, isMethodDeclaration, isObjectLiteralExpression, isPropertyAccessExpression, isPropertyAssignment, isSetAccessorDeclaration, isStringLiteral, isTypeNode, isTypeReferenceNode, isTypeUsableAsPropertyName, isYieldExpression, type LanguageServiceHost, length, map, type MethodDeclaration, type MethodSignature, type Modifier, ModifierFlags, type Node, type NodeArray, NodeBuilderFlags, NodeFlags, ObjectFlags, type ObjectLiteralExpression, type ObjectType, type ParameterDeclaration, type PrivateIdentifier, type Program, type PropertyAssignment, type PropertyDeclaration, type PropertyName, QuotePreference, sameMap, ScriptTarget, type SetAccessorDeclaration, setTextRange, type Signature, type SignatureDeclaration, signatureHasRestParameter, some, type SourceFile, type Symbol, SymbolFlags, type SymbolTracker, SyntaxKind, textChanges, type TextSpan, textSpanEnd, type TransientSymbol, tryCast, type TsConfigSourceFile, type Type, type TypeChecker, TypeFlags, type TypeNode, type TypeParameterDeclaration, type TypePredicate, unescapeLeadingUnderscores, type UnionType, type UserPreferences, visitEachChild, visitNode, visitNodes } from "../_namespaces/ts.ts";
/**
 * Finds members of the resolved type that are missing in the class pointed to by class decl
 * and generates source code for the missing members.
 * @param possiblyMissingSymbols The collection of symbols to filter and then get insertions for.
 * @param importAdder If provided, type annotations will use identifier type references instead of ImportTypeNodes, and the missing imports will be added to the importAdder.
 * @returns Empty string iff there are no member insertions.
 *
 * @internal
 */
export function createMissingMemberNodes(classDeclaration: ClassLikeDeclaration, possiblyMissingSymbols: readonly Symbol[], sourceFile: SourceFile, context: TypeConstructionContext, preferences: UserPreferences, importAdder: ImportAdder | undefined, addClassElement: (node: AddNode) => void): void {
    const classMembers = (classDeclaration.symbol)!.members;
    for (const symbol of possiblyMissingSymbols) {
        if (!(classMembers)!.has(symbol.escapedName)) {
            addNewNodeForMemberSymbol(symbol, classDeclaration, sourceFile, context, preferences, importAdder, addClassElement, /*body*/ undefined);
        }
    }
}
/** @internal */
export function getNoopSymbolTrackerWithResolver(context: TypeConstructionContext): SymbolTracker {
    return {
        trackSymbol: () => false,
        moduleResolverHost: getModuleSpecifierResolverHost(context.program, context.host),
    };
}
/** @internal */
export interface TypeConstructionContext {
    program: Program;
    host: LanguageServiceHost;
}
/** @internal */
export type AddNode = PropertyDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | MethodDeclaration | FunctionExpression | ArrowFunction;
/** @internal */
export type PreserveOptionalFlags = number;
/** @internal */
export const PreserveOptionalFlags: {
    readonly Method: 1;
    readonly Property: 2;
    readonly All: 3;
    [index: number]: string;
} = {
    Method: 1,
    "1": "Method",
    Property: 2,
    "2": "Property",
    All: 3,
    "3": "All"
};
/**
 * `addClassElement` will not be called if we can't figure out a representation for `symbol` in `enclosingDeclaration`.
 * @param body If defined, this will be the body of the member node passed to `addClassElement`. Otherwise, the body will default to a stub.
 *
 * @internal
 */
export function addNewNodeForMemberSymbol(symbol: Symbol, enclosingDeclaration: ClassLikeDeclaration, sourceFile: SourceFile, context: TypeConstructionContext, preferences: UserPreferences, importAdder: ImportAdder | undefined, addClassElement: (node: AddNode) => void, body: Block | undefined, preserveOptional: PreserveOptionalFlags = PreserveOptionalFlags.All, isAmbient = false): void {
    const declarations = requireCompilerMember(symbol, "getDeclarations").getDeclarations();
    const declaration = firstOrUndefined(declarations);
    const checker = context.program.getTypeChecker();
    const scriptTarget = getEmitScriptTarget(context.program.getCompilerOptions());
    /**
     * (#49811)
     * Note that there are cases in which the symbol declaration is not present. For example, in the code below both
     * `MappedIndirect.ax` and `MappedIndirect.ay` have no declaration node attached (due to their mapped-type
     * parent):
     *
     * ```ts
     * type Base = { ax: number; ay: string };
     * type BaseKeys = keyof Base;
     * type MappedIndirect = { [K in BaseKeys]: boolean };
     * ```
     *
     * In such cases, we assume the declaration to be a `PropertySignature`.
     */
    const kind = declaration?.kind ?? SyntaxKind.PropertySignature;
    const declarationName = createDeclarationName(symbol, declaration);
    const effectiveModifierFlags = declaration ? getEffectiveModifierFlags(declaration) : ModifierFlags.None;
    let modifierFlags = effectiveModifierFlags & ModifierFlags.Static;
    modifierFlags |= effectiveModifierFlags & ModifierFlags.Public ? ModifierFlags.Public :
        effectiveModifierFlags & ModifierFlags.Protected ? ModifierFlags.Protected :
            ModifierFlags.None;
    if (declaration && isAutoAccessorPropertyDeclaration(declaration)) {
        modifierFlags |= ModifierFlags.Accessor;
    }
    const modifiers = createModifiers();
    const type = checker.getWidenedType(checker.getTypeOfSymbolAtLocation(symbol, enclosingDeclaration));
    const optional = !!(symbol.flags & SymbolFlags.Optional);
    const ambient = !!(enclosingDeclaration.flags & NodeFlags.Ambient) || isAmbient;
    const quotePreference = getQuotePreference(sourceFile, preferences);
    const flags = NodeBuilderFlags.NoTruncation
        | (quotePreference === QuotePreference.Single ? NodeBuilderFlags.UseSingleQuotesForStringLiteralType : NodeBuilderFlags.None);
    switch (kind) {
        case SyntaxKind.PropertySignature:
        case SyntaxKind.PropertyDeclaration:
            let typeNode = checker.typeToTypeNode(type, enclosingDeclaration, flags, InternalNodeBuilderFlags.AllowUnresolvedNames, getNoopSymbolTrackerWithResolver(context));
            if (importAdder) {
                const importableReference = tryGetAutoImportableReferenceFromTypeNode(typeNode, scriptTarget);
                if (importableReference) {
                    typeNode = importableReference.typeNode;
                    importSymbols(importAdder, importableReference.symbols);
                }
            }
            addClassElement(factory.createPropertyDeclaration(modifiers, declaration ? createName(declarationName) : requireCompilerMember(symbol, "getName").getName(), optional && (preserveOptional & PreserveOptionalFlags.Property) ? factory.createToken(SyntaxKind.QuestionToken) : undefined, typeNode, 
            /*initializer*/ undefined));
            break;
        case SyntaxKind.GetAccessor:
        case SyntaxKind.SetAccessor: {
            Debug.assertIsDefined(declarations);
            let typeNode = checker.typeToTypeNode(type, enclosingDeclaration, flags, /*internalFlags*/ undefined, getNoopSymbolTrackerWithResolver(context));
            const allAccessors = getAllAccessorDeclarations(declarations, (checkedCompilerLayout(declaration, checked_isAccessor))!);
            const orderedAccessors = allAccessors.secondAccessor
                ? [allAccessors.firstAccessor, allAccessors.secondAccessor]
                : [allAccessors.firstAccessor];
            if (importAdder) {
                const importableReference = tryGetAutoImportableReferenceFromTypeNode(typeNode, scriptTarget);
                if (importableReference) {
                    typeNode = importableReference.typeNode;
                    importSymbols(importAdder, importableReference.symbols);
                }
            }
            for (const accessor of orderedAccessors) {
                if (isGetAccessorDeclaration(accessor)) {
                    addClassElement(factory.createGetAccessorDeclaration(modifiers, createName(declarationName), emptyArray, createTypeNode(typeNode), createBody(body, quotePreference, ambient)));
                }
                else {
                    Debug.assertNode(accessor, isSetAccessorDeclaration, "The counterpart to a getter should be a setter");
                    const parameter = getSetAccessorValueParameter(accessor);
                    const parameterName = parameter && isIdentifier(parameter.name) ? idText(parameter.name) : undefined;
                    addClassElement(factory.createSetAccessorDeclaration(modifiers, createName(declarationName), createDummyParameters(1, [parameterName], [createTypeNode(typeNode)], 1, /*inJs*/ false), createBody(body, quotePreference, ambient)));
                }
            }
            break;
        }
        case SyntaxKind.MethodSignature:
        case SyntaxKind.MethodDeclaration:
            // The signature for the implementation appears as an entry in `signatures` iff
            // there is only one signature.
            // If there are overloads and an implementation signature, it appears as an
            // extra declaration that isn't a signature for `type`.
            // If there is more than one overload but no implementation signature
            // (eg: an abstract method or interface declaration), there is a 1-1
            // correspondence of declarations and signatures.
            Debug.assertIsDefined(declarations);
            const signatures = testCompilerMethod_isUnion(type) ? flatMap(type.types, t => requireCompilerMember(t, "getCallSignatures").getCallSignatures()) : requireCompilerMember(type, "getCallSignatures").getCallSignatures();
            if (!some(signatures)) {
                break;
            }
            if (declarations.length === 1) {
                Debug.assert(signatures.length === 1, "One declaration implies one signature");
                const signature = signatures[0];
                outputMethod(quotePreference, signature, modifiers, createName(declarationName), createBody(body, quotePreference, ambient));
                break;
            }
            for (const signature of signatures) {
                if (signature.declaration && (signature.declaration.flags & NodeFlags.Ambient)) {
                    continue;
                }
                // Ensure nodes are fresh so they can have different positions when going through formatting.
                outputMethod(quotePreference, signature, modifiers, createName(declarationName));
            }
            if (!ambient) {
                if (declarations.length > signatures.length) {
                    const signature = checker.getSignatureFromDeclaration(checkedCompilerLayout(declarations[declarations.length - 1], isNodeLayout_b74b1ef9bfcc));
                    outputMethod(quotePreference, (signature)!, modifiers, createName(declarationName), createBody(body, quotePreference));
                }
                else {
                    Debug.assert(declarations.length === signatures.length, "Declarations and signatures should match count");
                    addClassElement(createMethodImplementingSignatures(checker, context, enclosingDeclaration, signatures, createName(declarationName), optional && !!(preserveOptional & PreserveOptionalFlags.Method), modifiers, quotePreference, body));
                }
            }
            break;
    }
    function outputMethod(quotePreference: QuotePreference, signature: Signature, modifiers: NodeArray<Modifier> | undefined, name: PropertyName, body?: Block): void {
        const method = checkedCompilerLayout(createSignatureDeclarationFromSignature(SyntaxKind.MethodDeclaration, context, quotePreference, signature, body, name, modifiers, optional && !!(preserveOptional & PreserveOptionalFlags.Method), enclosingDeclaration, importAdder), checked_isMethodDeclaration);
        if (method)
            addClassElement(method);
    }
    function createModifiers(): NodeArray<Modifier> | undefined {
        let modifiers: Modifier[] | undefined;
        if (modifierFlags) {
            modifiers = combine(modifiers, factory.createModifiersFromModifierFlags(modifierFlags));
        }
        if (shouldAddOverrideKeyword()) {
            modifiers = append(modifiers, factory.createToken(SyntaxKind.OverrideKeyword));
        }
        return modifiers && factory.createNodeArray(modifiers);
    }
    function shouldAddOverrideKeyword(): boolean {
        return !!(context.program.getCompilerOptions().noImplicitOverride && declaration && hasAbstractModifier(declaration));
    }
    function createName(node: PropertyName) {
        if (isIdentifier(node) && node.escapedText === "constructor") {
            return factory.createComputedPropertyName(factory.createStringLiteral(idText(node), quotePreference === QuotePreference.Single));
        }
        return getSynthesizedDeepClone(node, /*includeTrivia*/ false);
    }
    function createBody(block: Block | undefined, quotePreference: QuotePreference, ambient?: boolean) {
        return ambient ? undefined :
            getSynthesizedDeepClone(block, /*includeTrivia*/ false) || createStubbedMethodBody(quotePreference);
    }
    function createTypeNode(typeNode: TypeNode | undefined) {
        return getSynthesizedDeepClone(typeNode, /*includeTrivia*/ false);
    }
    function createDeclarationName(symbol: Symbol, declaration: Declaration | undefined): PropertyName {
        if (getCheckFlags(symbol) & CheckFlags.Mapped) {
            const nameType = (checkedCompilerLayout(symbol, checked_isTransientSymbol)).links.nameType;
            if (nameType && isTypeUsableAsPropertyName(nameType)) {
                return factory.createIdentifier(unescapeLeadingUnderscores(getPropertyNameFromType(nameType)));
            }
        }
        return checkedCompilerLayout(getSynthesizedDeepClone(getNameOfDeclaration(declaration), /*includeTrivia*/ false)!, checked_isPropertyName);
    }
}
/** @internal */
export function createSignatureDeclarationFromSignature(kind: typeof SyntaxKind.MethodDeclaration | typeof SyntaxKind.FunctionExpression | typeof SyntaxKind.ArrowFunction | typeof SyntaxKind.FunctionDeclaration, context: TypeConstructionContext, quotePreference: QuotePreference, signature: Signature, body: Block | undefined, name: PropertyName | undefined, modifiers: NodeArray<Modifier> | undefined, optional: boolean | undefined, enclosingDeclaration: Node | undefined, importAdder: ImportAdder | undefined): FunctionDeclaration | MethodDeclaration | FunctionExpression | ArrowFunction | undefined {
    const program = context.program;
    const checker = program.getTypeChecker();
    const scriptTarget = getEmitScriptTarget(program.getCompilerOptions());
    const isJs = isInJSFile(enclosingDeclaration);
    const flags = NodeBuilderFlags.NoTruncation
        | NodeBuilderFlags.SuppressAnyReturnType
        | NodeBuilderFlags.AllowEmptyTuple
        | (quotePreference === QuotePreference.Single ? NodeBuilderFlags.UseSingleQuotesForStringLiteralType : NodeBuilderFlags.None);
    const signatureDeclaration = checker.signatureToSignatureDeclaration(signature, kind, enclosingDeclaration, flags, InternalNodeBuilderFlags.AllowUnresolvedNames, getNoopSymbolTrackerWithResolver(context));
    if (!signatureDeclaration) {
        return undefined;
    }
    let typeParameters = isJs ? undefined : signatureDeclaration.typeParameters;
    let parameters = signatureDeclaration.parameters;
    let type = isJs ? undefined : getSynthesizedDeepClone(signatureDeclaration.type);
    if (importAdder) {
        if (typeParameters) {
            const newTypeParameters = sameMap(typeParameters, typeParameterDecl => {
                let constraint = typeParameterDecl.constraint;
                let defaultType = typeParameterDecl.default;
                if (constraint) {
                    const importableReference = tryGetAutoImportableReferenceFromTypeNode(constraint, scriptTarget);
                    if (importableReference) {
                        constraint = importableReference.typeNode;
                        importSymbols(importAdder, importableReference.symbols);
                    }
                }
                if (defaultType) {
                    const importableReference = tryGetAutoImportableReferenceFromTypeNode(defaultType, scriptTarget);
                    if (importableReference) {
                        defaultType = importableReference.typeNode;
                        importSymbols(importAdder, importableReference.symbols);
                    }
                }
                return factory.updateTypeParameterDeclaration(typeParameterDecl, typeParameterDecl.modifiers, typeParameterDecl.name, constraint, defaultType);
            });
            if (typeParameters !== newTypeParameters) {
                typeParameters = setTextRange(factory.createNodeArray(newTypeParameters, typeParameters.hasTrailingComma), typeParameters);
            }
        }
        const newParameters = sameMap(parameters, parameterDecl => {
            let type = isJs ? undefined : parameterDecl.type;
            if (type) {
                const importableReference = tryGetAutoImportableReferenceFromTypeNode(type, scriptTarget);
                if (importableReference) {
                    type = importableReference.typeNode;
                    importSymbols(importAdder, importableReference.symbols);
                }
            }
            return factory.updateParameterDeclaration(parameterDecl, parameterDecl.modifiers, parameterDecl.dotDotDotToken, parameterDecl.name, isJs ? undefined : parameterDecl.questionToken, type, parameterDecl.initializer);
        });
        if (parameters !== newParameters) {
            parameters = setTextRange(factory.createNodeArray(newParameters, parameters.hasTrailingComma), parameters);
        }
        if (type) {
            const importableReference = tryGetAutoImportableReferenceFromTypeNode(type, scriptTarget);
            if (importableReference) {
                type = importableReference.typeNode;
                importSymbols(importAdder, importableReference.symbols);
            }
        }
    }
    const questionToken = optional ? factory.createToken(SyntaxKind.QuestionToken) : undefined;
    const asteriskToken = signatureDeclaration.asteriskToken;
    if (isFunctionExpression(signatureDeclaration)) {
        return factory.updateFunctionExpression(signatureDeclaration, modifiers, signatureDeclaration.asteriskToken, tryCast(name, isIdentifier), typeParameters, parameters, type, body ?? signatureDeclaration.body);
    }
    if (isArrowFunction(signatureDeclaration)) {
        return factory.updateArrowFunction(signatureDeclaration, modifiers, typeParameters, parameters, type, signatureDeclaration.equalsGreaterThanToken, body ?? signatureDeclaration.body);
    }
    if (isMethodDeclaration(signatureDeclaration)) {
        return factory.updateMethodDeclaration(signatureDeclaration, modifiers, asteriskToken, name ?? factory.createIdentifier(""), questionToken, typeParameters, parameters, type, body);
    }
    if (isFunctionDeclaration(signatureDeclaration)) {
        return factory.updateFunctionDeclaration(signatureDeclaration, modifiers, signatureDeclaration.asteriskToken, tryCast(name, isIdentifier), typeParameters, parameters, type, body ?? signatureDeclaration.body);
    }
    return undefined;
}
/** @internal */
export function createSignatureDeclarationFromCallExpression(kind: typeof SyntaxKind.MethodDeclaration | typeof SyntaxKind.FunctionDeclaration | typeof SyntaxKind.MethodSignature, context: CodeFixContextBase, importAdder: ImportAdder, call: CallExpression, name: Identifier | PrivateIdentifier | string, modifierFlags: ModifierFlags, contextNode: Node): MethodDeclaration | FunctionDeclaration | MethodSignature {
    const quotePreference = getQuotePreference(context.sourceFile, context.preferences);
    const scriptTarget = getEmitScriptTarget(context.program.getCompilerOptions());
    const tracker = getNoopSymbolTrackerWithResolver(context);
    const checker = context.program.getTypeChecker();
    const isJs = isInJSFile(contextNode);
    const { typeArguments, arguments: args, parent } = call;
    const contextualType = isJs ? undefined : checker.getContextualType(call);
    const names = map(args, arg => isIdentifier(arg) ? arg.text : isPropertyAccessExpression(arg) && isIdentifier(arg.name) ? arg.name.text : undefined);
    const instanceTypes = isJs ? [] : map(args, arg => checker.getTypeAtLocation(arg));
    const { argumentTypeNodes, argumentTypeParameters } = getArgumentTypesAndTypeParameters(checker, importAdder, instanceTypes, contextNode, scriptTarget, NodeBuilderFlags.NoTruncation, InternalNodeBuilderFlags.AllowUnresolvedNames, tracker);
    const modifiers = modifierFlags
        ? factory.createNodeArray(factory.createModifiersFromModifierFlags(modifierFlags))
        : undefined;
    const asteriskToken = testCompilerLayout(parent, isYieldExpression) ? factory.createToken(SyntaxKind.AsteriskToken)
        : undefined;
    const typeParameters = isJs ? undefined : createTypeParametersForArguments(checker, argumentTypeParameters, typeArguments);
    const parameters = createDummyParameters(args.length, names, argumentTypeNodes, /*minArgumentCount*/ undefined, isJs);
    const type = isJs || contextualType === undefined
        ? undefined
        : checker.typeToTypeNode(contextualType, contextNode, /*flags*/ undefined, /*internalFlags*/ undefined, tracker);
    switch (kind) {
        case SyntaxKind.MethodDeclaration:
            return factory.createMethodDeclaration(modifiers, asteriskToken, name, 
            /*questionToken*/ undefined, typeParameters, parameters, type, createStubbedMethodBody(quotePreference));
        case SyntaxKind.MethodSignature:
            return factory.createMethodSignature(modifiers, name, 
            /*questionToken*/ undefined, typeParameters, parameters, type === undefined ? factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword) : type);
        case SyntaxKind.FunctionDeclaration:
            Debug.assert(typeof name === "string" || isIdentifier(name), "Unexpected name");
            return factory.createFunctionDeclaration(modifiers, asteriskToken, name, typeParameters, parameters, type, createStubbedBody(Diagnostics.Function_not_implemented.message, quotePreference));
        default:
            Debug.fail("Unexpected kind");
    }
}
/** @internal */
export interface ArgumentTypeParameterAndConstraint {
    argumentType: Type;
    constraint?: TypeNode;
}
function createTypeParametersForArguments(checker: TypeChecker, argumentTypeParameters: [
    string,
    ArgumentTypeParameterAndConstraint | undefined
][], typeArguments: NodeArray<TypeNode> | undefined) {
    const usedNames = new Set(argumentTypeParameters.map(pair => pair[0]));
    const constraintsByName = new Map(argumentTypeParameters);
    if (typeArguments) {
        const typeArgumentsWithNewTypes = typeArguments.filter(typeArgument => !argumentTypeParameters.some(pair => checker.getTypeAtLocation(typeArgument) === pair[1]?.argumentType));
        const targetSize = usedNames.size + typeArgumentsWithNewTypes.length;
        for (let i = 0; usedNames.size < targetSize; i += 1) {
            usedNames.add(createTypeParameterName(i));
        }
    }
    return arrayFrom(usedNames.values(), usedName => factory.createTypeParameterDeclaration(/*modifiers*/ undefined, usedName, constraintsByName.get(usedName)?.constraint));
}
function createTypeParameterName(index: number) {
    return CharacterCodes.T + index <= CharacterCodes.Z
        ? String.fromCharCode(CharacterCodes.T + index)
        : `T${index}`;
}
/** @internal */
export function typeToAutoImportableTypeNode(checker: TypeChecker, importAdder: ImportAdder, type: Type, contextNode: Node | undefined, scriptTarget: ScriptTarget, flags?: NodeBuilderFlags, internalFlags?: InternalNodeBuilderFlags, tracker?: SymbolTracker): TypeNode | undefined {
    const typeNode = checker.typeToTypeNode(type, contextNode, flags, internalFlags, tracker);
    if (!typeNode) {
        return undefined;
    }
    return typeNodeToAutoImportableTypeNode(typeNode, importAdder, scriptTarget);
}
/** @internal */
export function typeNodeToAutoImportableTypeNode(typeNode: TypeNode, importAdder: ImportAdder, scriptTarget: ScriptTarget): TypeNode | undefined {
    const importableReference = tryGetAutoImportableReferenceFromTypeNode(typeNode, scriptTarget);
    if (importableReference) {
        importSymbols(importAdder, importableReference.symbols);
        typeNode = importableReference.typeNode;
    }
    // Ensure nodes are fresh so they can have different positions when going through formatting.
    return getSynthesizedDeepClone(typeNode);
}
function endOfRequiredTypeParameters(checker: TypeChecker, type: GenericType): number {
    Debug.assert(type.typeArguments);
    const fullTypeArguments = type.typeArguments;
    const target = type.target;
    for (let cutoff = 0; cutoff < fullTypeArguments.length; cutoff++) {
        if (target.localTypeParameters?.[cutoff].constraint === undefined) {
            continue;
        }
        const typeArguments = fullTypeArguments.slice(0, cutoff);
        const filledIn = checker.fillMissingTypeArguments(typeArguments, target.typeParameters, cutoff, /*isJavaScriptImplicitAny*/ false);
        if (filledIn.every((fill, i) => fill === fullTypeArguments[i])) {
            return cutoff;
        }
    }
    // If we make it all the way here, all the type arguments are required.
    return fullTypeArguments.length;
}
/** @internal */
export function typeToMinimizedReferenceType(checker: TypeChecker, type: Type, contextNode: Node | undefined, flags?: NodeBuilderFlags, internalFlags?: InternalNodeBuilderFlags, tracker?: SymbolTracker): TypeNode | undefined {
    let typeNode = checker.typeToTypeNode(type, contextNode, flags, internalFlags, tracker);
    if (!typeNode) {
        return undefined;
    }
    if (isTypeReferenceNode(typeNode)) {
        const genericType = checkedCompilerLayout(type, checked_isCompilerGenericType);
        if (genericType.typeArguments && typeNode.typeArguments) {
            const cutoff = endOfRequiredTypeParameters(checker, genericType);
            if (cutoff < typeNode.typeArguments.length) {
                const newTypeArguments = factory.createNodeArray(typeNode.typeArguments.slice(0, cutoff));
                typeNode = factory.updateTypeReferenceNode(typeNode, typeNode.typeName, newTypeArguments);
            }
        }
    }
    return typeNode;
}
/** @internal */
export function typePredicateToAutoImportableTypeNode(checker: TypeChecker, importAdder: ImportAdder, typePredicate: TypePredicate, contextNode: Node | undefined, scriptTarget: ScriptTarget, flags?: NodeBuilderFlags, internalFlags?: InternalNodeBuilderFlags, tracker?: SymbolTracker): TypeNode | undefined {
    let typePredicateNode = checker.typePredicateToTypePredicateNode(typePredicate, contextNode, flags, internalFlags, tracker);
    if (typePredicateNode?.type && isImportTypeNode(typePredicateNode.type)) {
        const importableReference = tryGetAutoImportableReferenceFromTypeNode(typePredicateNode.type, scriptTarget);
        if (importableReference) {
            importSymbols(importAdder, importableReference.symbols);
            typePredicateNode = factory.updateTypePredicateNode(typePredicateNode, typePredicateNode.assertsModifier, typePredicateNode.parameterName, importableReference.typeNode);
        }
    }
    // Ensure nodes are fresh so they can have different positions when going through formatting.
    return getSynthesizedDeepClone(typePredicateNode);
}
function typeContainsTypeParameter(type: Type) {
    if (testCompilerMethod_isUnionOrIntersection(type)) {
        return type.types.some(typeContainsTypeParameter);
    }
    return type.flags & TypeFlags.TypeParameter;
}
function getArgumentTypesAndTypeParameters(checker: TypeChecker, importAdder: ImportAdder, instanceTypes: Type[], contextNode: Node | undefined, scriptTarget: ScriptTarget, flags?: NodeBuilderFlags, internalFlags?: InternalNodeBuilderFlags, tracker?: SymbolTracker) {
    // Types to be used as the types of the parameters in the new function
    // E.g. from this source:
    //   added("", 0)
    // The value will look like:
    //   [{ typeName: { text: "string" } }, { typeName: { text: "number" }]
    // And in the output function will generate:
    //   function added(a: string, b: number) { ... }
    const argumentTypeNodes: TypeNode[] = [];
    // Names of type parameters provided as arguments to the call
    // E.g. from this source:
    //   added<T, U>(value);
    // The value will look like:
    //   [
    //     ["T", { argumentType: { typeName: { text: "T" } } } ],
    //     ["U", { argumentType: { typeName: { text: "U" } } } ],
    //   ]
    // And in the output function will generate:
    //   function added<T, U>() { ... }
    const argumentTypeParameters = new Map<string, ArgumentTypeParameterAndConstraint | undefined>();
    for (let i = 0; i < instanceTypes.length; i += 1) {
        const instanceType = instanceTypes[i];
        // If the instance type contains a deep reference to an existing type parameter,
        // instead of copying the full union or intersection, create a new type parameter
        // E.g. from this source:
        //   function existing<T, U>(value: T | U & string) {
        //     added/*1*/(value);
        // We don't want to output this:
        //    function added<T>(value: T | U & string) { ... }
        // We instead want to output:
        //    function added<T>(value: T) { ... }
        if (testCompilerMethod_isUnionOrIntersection(instanceType) && instanceType.types.some(typeContainsTypeParameter)) {
            const synthesizedTypeParameterName = createTypeParameterName(i);
            argumentTypeNodes.push(factory.createTypeReferenceNode(synthesizedTypeParameterName));
            argumentTypeParameters.set(synthesizedTypeParameterName, undefined);
            continue;
        }
        // Widen the type so we don't emit nonsense annotations like "function fn(x: 3) {"
        const widenedInstanceType = checker.getBaseTypeOfLiteralType(instanceType);
        const argumentTypeNode = typeToAutoImportableTypeNode(checker, importAdder, widenedInstanceType, contextNode, scriptTarget, flags, internalFlags, tracker);
        if (!argumentTypeNode) {
            continue;
        }
        argumentTypeNodes.push(argumentTypeNode);
        const argumentTypeParameter = getFirstTypeParameterName(instanceType);
        // If the instance type is a type parameter with a constraint (other than an anonymous object),
        // remember that constraint for when we create the new type parameter
        // E.g. from this source:
        //   function existing<T extends string>(value: T) {
        //     added/*1*/(value);
        // We don't want to output this:
        //    function added<T>(value: T) { ... }
        // We instead want to output:
        //    function added<T extends string>(value: T) { ... }
        const instanceTypeConstraint = testCompilerMethod_isTypeParameter(instanceType) && instanceType.constraint && !isAnonymousObjectConstraintType(instanceType.constraint)
            ? typeToAutoImportableTypeNode(checker, importAdder, instanceType.constraint, contextNode, scriptTarget, flags, internalFlags, tracker)
            : undefined;
        if (argumentTypeParameter) {
            argumentTypeParameters.set(argumentTypeParameter, { argumentType: instanceType, constraint: instanceTypeConstraint });
        }
    }
    return { argumentTypeNodes, argumentTypeParameters: arrayFrom(argumentTypeParameters.entries()) };
}
function isAnonymousObjectConstraintType(type: Type) {
    return (type.flags & TypeFlags.Object) && (checkedCompilerLayout(type, checked_isCompilerObjectType)).objectFlags === ObjectFlags.Anonymous;
}
function getFirstTypeParameterName(type: Type): string | undefined {
    if (type.flags & (TypeFlags.Union | TypeFlags.Intersection)) {
        for (const subType of checkedCompilerLayout(type, isCompilerUnionOrIntersectionType).types) {
            const subTypeName = getFirstTypeParameterName(subType);
            if (subTypeName) {
                return subTypeName;
            }
        }
    }
    return type.flags & TypeFlags.TypeParameter
        ? requireCompilerMember(type, "getSymbol").getSymbol()?.getName!()
        : undefined;
}
function createDummyParameters(argCount: number, names: (string | undefined)[] | undefined, types: (TypeNode | undefined)[] | undefined, minArgumentCount: number | undefined, inJs: boolean): ParameterDeclaration[] {
    const parameters: ParameterDeclaration[] = [];
    const parameterNameCounts = new Map<string, number>();
    for (let i = 0; i < argCount; i++) {
        const parameterName = names?.[i] || `arg${i}`;
        const parameterNameCount = parameterNameCounts.get(parameterName);
        parameterNameCounts.set(parameterName, (parameterNameCount || 0) + 1);
        const newParameter = factory.createParameterDeclaration(
        /*modifiers*/ undefined, 
        /*dotDotDotToken*/ undefined, 
        /*name*/ parameterName + (parameterNameCount || ""), 
        /*questionToken*/ minArgumentCount !== undefined && i >= minArgumentCount ? factory.createToken(SyntaxKind.QuestionToken) : undefined, 
        /*type*/ inJs ? undefined : types?.[i] || factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword), 
        /*initializer*/ undefined);
        parameters.push(newParameter);
    }
    return parameters;
}
function createMethodImplementingSignatures(checker: TypeChecker, context: TypeConstructionContext, enclosingDeclaration: ClassLikeDeclaration, signatures: readonly Signature[], name: PropertyName, optional: boolean, modifiers: readonly Modifier[] | undefined, quotePreference: QuotePreference, body: Block | undefined): MethodDeclaration {
    /** This is *a* signature with the maximal number of arguments,
     * such that if there is a "maximal" signature without rest arguments,
     * this is one of them.
     */
    let maxArgsSignature = signatures[0];
    let minArgumentCount = signatures[0].minArgumentCount;
    let someSigHasRestParameter = false;
    for (const sig of signatures) {
        minArgumentCount = Math.min(sig.minArgumentCount, minArgumentCount);
        if (signatureHasRestParameter(sig)) {
            someSigHasRestParameter = true;
        }
        if (sig.parameters.length >= maxArgsSignature.parameters.length && (!signatureHasRestParameter(sig) || signatureHasRestParameter(maxArgsSignature))) {
            maxArgsSignature = sig;
        }
    }
    const maxNonRestArgs = maxArgsSignature.parameters.length - (signatureHasRestParameter(maxArgsSignature) ? 1 : 0);
    const maxArgsParameterSymbolNames = maxArgsSignature.parameters.map(symbol => symbol.name);
    const parameters = createDummyParameters(maxNonRestArgs, maxArgsParameterSymbolNames, /*types*/ undefined, minArgumentCount, /*inJs*/ false);
    if (someSigHasRestParameter) {
        const restParameter = factory.createParameterDeclaration(
        /*modifiers*/ undefined, factory.createToken(SyntaxKind.DotDotDotToken), maxArgsParameterSymbolNames[maxNonRestArgs] || "rest", 
        /*questionToken*/ maxNonRestArgs >= minArgumentCount ? factory.createToken(SyntaxKind.QuestionToken) : undefined, factory.createArrayTypeNode(factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword)), 
        /*initializer*/ undefined);
        parameters.push(restParameter);
    }
    return createStubbedMethod(modifiers, name, optional, 
    /*typeParameters*/ undefined, parameters, getReturnTypeFromSignatures(signatures, checker, context, enclosingDeclaration), quotePreference, body);
}
function getReturnTypeFromSignatures(signatures: readonly Signature[], checker: TypeChecker, context: TypeConstructionContext, enclosingDeclaration: ClassLikeDeclaration): TypeNode | undefined {
    if (length(signatures)) {
        const type = checker.getUnionType(map(signatures, checker.getReturnTypeOfSignature));
        return checker.typeToTypeNode(type, enclosingDeclaration, NodeBuilderFlags.NoTruncation, InternalNodeBuilderFlags.AllowUnresolvedNames, getNoopSymbolTrackerWithResolver(context));
    }
}
function createStubbedMethod(modifiers: readonly Modifier[] | undefined, name: PropertyName, optional: boolean, typeParameters: readonly TypeParameterDeclaration[] | undefined, parameters: readonly ParameterDeclaration[], returnType: TypeNode | undefined, quotePreference: QuotePreference, body: Block | undefined): MethodDeclaration {
    return factory.createMethodDeclaration(modifiers, 
    /*asteriskToken*/ undefined, name, optional ? factory.createToken(SyntaxKind.QuestionToken) : undefined, typeParameters, parameters, returnType, body || createStubbedMethodBody(quotePreference));
}
function createStubbedMethodBody(quotePreference: QuotePreference) {
    return createStubbedBody(Diagnostics.Method_not_implemented.message, quotePreference);
}
/** @internal */
export function createStubbedBody(text: string, quotePreference: QuotePreference): Block {
    return factory.createBlock([factory.createThrowStatement(factory.createNewExpression(factory.createIdentifier("Error"), 
        /*typeArguments*/ undefined, 
        // TODO Handle auto quote preference.
        [factory.createStringLiteral(text, /*isSingleQuote*/ quotePreference === QuotePreference.Single)]))], 
    /*multiLine*/ true);
}
/** @internal */
export function setJsonCompilerOptionValues(changeTracker: textChanges.ChangeTracker, configFile: TsConfigSourceFile, options: [
    string,
    Expression
][]): undefined {
    const tsconfigObjectLiteral = getTsConfigObjectLiteralExpression(configFile);
    if (!tsconfigObjectLiteral)
        return undefined;
    const compilerOptionsProperty = findJsonProperty(tsconfigObjectLiteral, "compilerOptions");
    if (compilerOptionsProperty === undefined) {
        changeTracker.insertNodeAtObjectStart(configFile, tsconfigObjectLiteral, createJsonPropertyAssignment("compilerOptions", factory.createObjectLiteralExpression(options.map(([optionName, optionValue]) => createJsonPropertyAssignment(optionName, optionValue)), /*multiLine*/ true)));
        return;
    }
    const compilerOptions = compilerOptionsProperty.initializer;
    if (!isObjectLiteralExpression(compilerOptions)) {
        return;
    }
    for (const [optionName, optionValue] of options) {
        const optionProperty = findJsonProperty(compilerOptions, optionName);
        if (optionProperty === undefined) {
            changeTracker.insertNodeAtObjectStart(configFile, compilerOptions, createJsonPropertyAssignment(optionName, optionValue));
        }
        else {
            changeTracker.replaceNode(configFile, optionProperty.initializer, optionValue);
        }
    }
}
/** @internal */
export function setJsonCompilerOptionValue(changeTracker: textChanges.ChangeTracker, configFile: TsConfigSourceFile, optionName: string, optionValue: Expression): void {
    setJsonCompilerOptionValues(changeTracker, configFile, [[optionName, optionValue]]);
}
function createJsonPropertyAssignment(name: string, initializer: Expression) {
    return factory.createPropertyAssignment(factory.createStringLiteral(name), initializer);
}
function findJsonProperty(obj: ObjectLiteralExpression, name: string): PropertyAssignment | undefined {
    return find(obj.properties, (p): p is PropertyAssignment => isPropertyAssignment(p) && !!p.name && isStringLiteral(p.name) && p.name.text === name);
}
/**
 * Given a type node containing 'import("./a").SomeType<import("./b").OtherType<...>>',
 * returns an equivalent type reference node with any nested ImportTypeNodes also replaced
 * with type references, and a list of symbols that must be imported to use the type reference.
 *
 * @internal
 */
export function tryGetAutoImportableReferenceFromTypeNode(importTypeNode: TypeNode | undefined, scriptTarget: ScriptTarget): {
    typeNode: TypeNode;
    symbols: Symbol[];
} | undefined {
    let symbols: Symbol[] | undefined;
    const typeNode = visitNode(importTypeNode, visit, isTypeNode);
    if (symbols && typeNode) {
        return { typeNode, symbols };
    }
    function visit(node: Node): Node {
        if (isLiteralImportTypeNode(node) && node.qualifier) {
            // Symbol for the left-most thing after the dot
            const firstIdentifier = getFirstIdentifier(node.qualifier);
            if (!firstIdentifier.symbol) {
                // if symbol is missing then this doesn't come from a synthesized import type node
                // it has to be an import type node authored by the user and thus it has to be valid
                // it can't refer to reserved internal symbol names and such
                return visitEachChild(node, visit, /*context*/ undefined);
            }
            const name = getNameForExportedSymbol(firstIdentifier.symbol, scriptTarget);
            const qualifier = name !== firstIdentifier.text
                ? replaceFirstIdentifierOfEntityName(node.qualifier, factory.createIdentifier(name))
                : node.qualifier;
            symbols = append(symbols, firstIdentifier.symbol);
            const typeArguments = visitNodes(node.typeArguments, visit, isTypeNode);
            return factory.createTypeReferenceNode(qualifier, typeArguments);
        }
        return visitEachChild(node, visit, /*context*/ undefined);
    }
}
function replaceFirstIdentifierOfEntityName(name: EntityName, newIdentifier: Identifier): EntityName {
    if (name.kind === SyntaxKind.Identifier) {
        return newIdentifier;
    }
    return factory.createQualifiedName(replaceFirstIdentifierOfEntityName(name.left, newIdentifier), name.right);
}
/** @internal */
export function importSymbols(importAdder: ImportAdder, symbols: readonly Symbol[]): void {
    symbols.forEach(s => importAdder.addImportFromExportedSymbol(s, /*isValidTypeOnlyUseSite*/ true));
}
/** @internal */
export function findAncestorMatchingSpan(sourceFile: SourceFile, span: TextSpan): Node {
    const end = textSpanEnd(span);
    let token = getTokenAtPosition(sourceFile, span.start);
    while (token.end < end) {
        token = (checkedCompilerLayout(token.parent, isCompilerSyntaxNode))!;
    }
    return token;
}
