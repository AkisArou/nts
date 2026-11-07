// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0; see benchmarks/cases/LICENSE-jetstream.
// Authored source: microsoft/TypeScript@5be33469d551655d878876faa9e30aa3b49f8ee9/src/services/codefixes/generateAccessors.ts
// Modified for nts: strict layouts, erasable module/class packaging and checked views.
// Original algorithms and inputs retained; adaptations are listed in README.md.
import type { ClassLikeDeclaration as AccessorClassLike } from "../../compiler/types.ts";
import { isNodeLayout_7956af0f59b1 } from "../../checkedLayouts.ts";
import { requireCompilerMember } from "../../checked.ts";
import { present } from "../../checked.ts";
import { isClassLike as checked_isClassLike } from "../_namespaces/ts.ts";
import { checkedCompilerLayout } from "../../checked.ts";
import { type AccessorDeclaration, canHaveDecorators, cast, type ClassLikeDeclaration, concatenate, type ConstructorDeclaration, type DeclarationName, Diagnostics, factory, type FileTextChanges, findAncestor, getDecorators, getEffectiveModifierFlags, getFirstConstructorWithBody, getLocaleSpecificMessage, getTokenAtPosition, getTypeAnnotationNode, getUniqueName, hasEffectiveReadonlyModifier, hasStaticModifier, type Identifier, isClassLike, isElementAccessExpression, isFunctionLike, isIdentifier, isParameterPropertyDeclaration, isPropertyAccessExpression, isPropertyAssignment, isPropertyDeclaration, isSourceFileJS, isStringLiteral, isUnionTypeNode, isWriteAccess, ModifierFlags, type ModifierLike, type Mutable, type Node, nodeOverlapsWithStartEnd, type ObjectLiteralExpression, type ParameterPropertyDeclaration, type Program, type PropertyAssignment, type PropertyDeclaration, refactor, type SourceFile, startsWithUnderscore, type StringLiteral, suppressLeadingAndTrailingTrivia, SyntaxKind, textChanges, type TypeNode } from "../_namespaces/ts.ts";
/** @internal */
export type AcceptedDeclaration = ParameterPropertyDeclaration | PropertyDeclaration | PropertyAssignment;
/** @internal */
export type AcceptedNameType = Identifier | StringLiteral;
/** @internal */
export type ContainerDeclaration = ClassLikeDeclaration | ObjectLiteralExpression;
/** @internal */
export type AccessorOrRefactorErrorInfo = AccessorInfo | refactor.RefactorErrorInfo;
/** @internal */
export interface AccessorInfo {
    container: ContainerDeclaration;
    isStatic: boolean;
    isReadonly: boolean;
    type: TypeNode | undefined;
    declaration: AcceptedDeclaration;
    fieldName: AcceptedNameType;
    accessorName: AcceptedNameType;
    originalName: string;
    renameAccessor: boolean;
}
/** @internal */
export function generateAccessorFromProperty(file: SourceFile, program: Program, start: number, end: number, context: textChanges.TextChangesContext, _actionName: string): FileTextChanges[] | undefined {
    const fieldInfo = getAccessorConvertiblePropertyAtPosition(file, program, start, end);
    if (!fieldInfo || refactor.isRefactorErrorInfo(fieldInfo))
        return undefined;
    const changeTracker = textChanges.ChangeTracker.fromContext(context);
    const { isStatic, isReadonly, fieldName, accessorName, originalName, type, container, declaration } = fieldInfo;
    suppressLeadingAndTrailingTrivia(fieldName);
    suppressLeadingAndTrailingTrivia(accessorName);
    suppressLeadingAndTrailingTrivia(declaration);
    suppressLeadingAndTrailingTrivia(container);
    let accessorModifiers: readonly ModifierLike[] | undefined;
    let fieldModifiers: readonly ModifierLike[] | undefined;
    if (isClassLike(container)) {
        const modifierFlags = getEffectiveModifierFlags(declaration);
        if (isSourceFileJS(file)) {
            const modifiers = factory.createModifiersFromModifierFlags(modifierFlags);
            accessorModifiers = modifiers;
            fieldModifiers = modifiers;
        }
        else {
            accessorModifiers = factory.createModifiersFromModifierFlags(prepareModifierFlagsForAccessor(modifierFlags));
            fieldModifiers = factory.createModifiersFromModifierFlags(prepareModifierFlagsForField(modifierFlags));
        }
        if (canHaveDecorators(declaration)) {
            fieldModifiers = concatenate(getDecorators(declaration), fieldModifiers);
        }
    }
    updateFieldDeclaration(changeTracker, file, declaration, type, fieldName, fieldModifiers);
    const getAccessor = generateGetAccessor(fieldName, accessorName, type, accessorModifiers, isStatic, container);
    suppressLeadingAndTrailingTrivia(getAccessor);
    insertAccessor(changeTracker, file, getAccessor, declaration, container);
    if (isReadonly) {
        // readonly modifier only existed in classLikeDeclaration
        const constructor = getFirstConstructorWithBody(checkedCompilerLayout(container, isAccessorClassLike));
        if (constructor) {
            updateReadonlyPropertyInitializerStatementConstructor(changeTracker, file, constructor, (fieldName.text)!, originalName);
        }
    }
    else {
        const setAccessor = generateSetAccessor(fieldName, accessorName, type, accessorModifiers, isStatic, container);
        suppressLeadingAndTrailingTrivia(setAccessor);
        insertAccessor(changeTracker, file, setAccessor, declaration, container);
    }
    return changeTracker.getChanges();
}
function isConvertibleName(name: DeclarationName): name is AcceptedNameType {
    return isIdentifier(name) || isStringLiteral(name);
}
function isAcceptedDeclaration(node: Node): node is AcceptedDeclaration {
    return isParameterPropertyDeclaration(node, (node.parent)!) || isPropertyDeclaration(node) || isPropertyAssignment(node);
}
function createPropertyName(name: string, originalName: AcceptedNameType) {
    return isIdentifier(originalName) ? factory.createIdentifier(name) : factory.createStringLiteral(name);
}
function createAccessorAccessExpression(fieldName: AcceptedNameType, isStatic: boolean, container: ContainerDeclaration) {
    const leftHead = isStatic ? checkedCompilerLayout((checkedCompilerLayout(container, isAccessorClassLike)), isNodeLayout_7956af0f59b1).name : factory.createThis(); // TODO: GH#18217
    return isIdentifier(fieldName) ? factory.createPropertyAccessExpression((leftHead)!, fieldName) : factory.createElementAccessExpression((leftHead)!, factory.createStringLiteralFromNode(fieldName));
}
function prepareModifierFlagsForAccessor(modifierFlags: ModifierFlags): ModifierFlags {
    modifierFlags &= ~ModifierFlags.Readonly; // avoid Readonly modifier because it will convert to get accessor
    modifierFlags &= ~ModifierFlags.Private;
    if (!(modifierFlags & ModifierFlags.Protected)) {
        modifierFlags |= ModifierFlags.Public;
    }
    return modifierFlags;
}
function prepareModifierFlagsForField(modifierFlags: ModifierFlags): ModifierFlags {
    modifierFlags &= ~ModifierFlags.Public;
    modifierFlags &= ~ModifierFlags.Protected;
    modifierFlags |= ModifierFlags.Private;
    return modifierFlags;
}
/** @internal */
export function getAccessorConvertiblePropertyAtPosition(file: SourceFile, program: Program, start: number, end: number, considerEmptySpans = true): AccessorOrRefactorErrorInfo | undefined {
    const node = getTokenAtPosition(file, start);
    const cursorRequest = start === end && considerEmptySpans;
    const declaration = findAncestor(node.parent, isAcceptedDeclaration);
    // make sure declaration have AccessibilityModifier or Static Modifier or Readonly Modifier
    const meaning = ModifierFlags.AccessibilityModifier | ModifierFlags.Static | ModifierFlags.Readonly;
    if (!declaration || (!(nodeOverlapsWithStartEnd(declaration.name, file, start, end) || cursorRequest))) {
        return {
            error: getLocaleSpecificMessage(Diagnostics.Could_not_find_property_for_which_to_generate_accessor),
        };
    }
    if (!isConvertibleName(declaration.name)) {
        return {
            error: getLocaleSpecificMessage(Diagnostics.Name_is_not_valid),
        };
    }
    if (((getEffectiveModifierFlags(declaration) & ModifierFlags.Modifier) | meaning) !== meaning) {
        return {
            error: getLocaleSpecificMessage(Diagnostics.Can_only_convert_property_with_modifier),
        };
    }
    const name = declaration.name.text;
    const startWithUnderscore = startsWithUnderscore((name)!);
    const fieldName = createPropertyName((startWithUnderscore ? name : getUniqueName(`_${name}`, file))!, declaration.name);
    const accessorName = createPropertyName((startWithUnderscore ? getUniqueName((name)!.substring(1), file) : name)!, declaration.name);
    return {
        isStatic: hasStaticModifier(declaration),
        isReadonly: hasEffectiveReadonlyModifier(declaration),
        type: getDeclarationType(declaration, program),
        container: declaration.kind === SyntaxKind.Parameter ? declaration.parent.parent : declaration.parent,
        originalName: ((declaration.name).text)!,
        declaration,
        fieldName,
        accessorName,
        renameAccessor: startWithUnderscore,
    };
}
function generateGetAccessor(fieldName: AcceptedNameType, accessorName: AcceptedNameType, type: TypeNode | undefined, modifiers: readonly ModifierLike[] | undefined, isStatic: boolean, container: ContainerDeclaration) {
    return factory.createGetAccessorDeclaration(modifiers, accessorName, [], type, factory.createBlock([
        factory.createReturnStatement(createAccessorAccessExpression(fieldName, isStatic, container)),
    ], /*multiLine*/ true));
}
function generateSetAccessor(fieldName: AcceptedNameType, accessorName: AcceptedNameType, type: TypeNode | undefined, modifiers: readonly ModifierLike[] | undefined, isStatic: boolean, container: ContainerDeclaration) {
    return factory.createSetAccessorDeclaration(modifiers, accessorName, [factory.createParameterDeclaration(
        /*modifiers*/ undefined, 
        /*dotDotDotToken*/ undefined, factory.createIdentifier("value"), 
        /*questionToken*/ undefined, type)], factory.createBlock([
        factory.createExpressionStatement(factory.createAssignment(createAccessorAccessExpression(fieldName, isStatic, container), factory.createIdentifier("value"))),
    ], /*multiLine*/ true));
}
function updatePropertyDeclaration(changeTracker: textChanges.ChangeTracker, file: SourceFile, declaration: PropertyDeclaration, type: TypeNode | undefined, fieldName: AcceptedNameType, modifiers: readonly ModifierLike[] | undefined) {
    const property = factory.updatePropertyDeclaration(declaration, modifiers, fieldName, declaration.questionToken || declaration.exclamationToken, type, declaration.initializer);
    changeTracker.replaceNode(file, declaration, property);
}
function updatePropertyAssignmentDeclaration(changeTracker: textChanges.ChangeTracker, file: SourceFile, declaration: PropertyAssignment, fieldName: AcceptedNameType) {
    let assignment = factory.updatePropertyAssignment(declaration, fieldName, declaration.initializer);
    // Remove grammar errors from assignment
    if (assignment.modifiers || assignment.questionToken || assignment.exclamationToken) {
        if (assignment === declaration)
            assignment = factory.cloneNode(assignment);
        (assignment).modifiers = undefined;
        (assignment).questionToken = undefined;
        (assignment).exclamationToken = undefined;
    }
    changeTracker.replacePropertyAssignment(file, declaration, assignment);
}
function updateFieldDeclaration(changeTracker: textChanges.ChangeTracker, file: SourceFile, declaration: AcceptedDeclaration, type: TypeNode | undefined, fieldName: AcceptedNameType, modifiers: readonly ModifierLike[] | undefined) {
    if (isPropertyDeclaration(declaration)) {
        updatePropertyDeclaration(changeTracker, file, declaration, type, fieldName, modifiers);
    }
    else if (isPropertyAssignment(declaration)) {
        updatePropertyAssignmentDeclaration(changeTracker, file, declaration, fieldName);
    }
    else {
        changeTracker.replaceNode(file, declaration, factory.updateParameterDeclaration(declaration, modifiers, declaration.dotDotDotToken, cast(fieldName, isIdentifier), declaration.questionToken, declaration.type, declaration.initializer));
    }
}
function insertAccessor(changeTracker: textChanges.ChangeTracker, file: SourceFile, accessor: AccessorDeclaration, declaration: AcceptedDeclaration, container: ContainerDeclaration) {
    isParameterPropertyDeclaration(declaration, declaration.parent) ? changeTracker.insertMemberAtStart(file, checkedCompilerLayout(container, isAccessorClassLike), accessor) :
        isPropertyAssignment(declaration) ? changeTracker.insertNodeAfterComma(file, declaration, accessor) :
            changeTracker.insertNodeAfter(file, declaration, accessor);
}
function updateReadonlyPropertyInitializerStatementConstructor(changeTracker: textChanges.ChangeTracker, file: SourceFile, constructor: ConstructorDeclaration, fieldName: string, originalName: string) {
    if (!constructor.body)
        return;
    requireCompilerMember(constructor.body, "forEachChild").forEachChild(function recur(node) {
        if (isElementAccessExpression(node) &&
            node.expression.kind === SyntaxKind.ThisKeyword &&
            isStringLiteral(node.argumentExpression) &&
            node.argumentExpression.text === originalName &&
            isWriteAccess(node)) {
            changeTracker.replaceNode(file, node.argumentExpression, factory.createStringLiteral(fieldName));
        }
        if (isPropertyAccessExpression(node) && node.expression.kind === SyntaxKind.ThisKeyword && node.name.text === originalName && isWriteAccess(node)) {
            changeTracker.replaceNode(file, node.name, factory.createIdentifier(fieldName));
        }
        if (!isFunctionLike(node) && !isClassLike(node)) {
            requireCompilerMember(node, "forEachChild").forEachChild(recur);
        }
    });
}
function getDeclarationType(declaration: AcceptedDeclaration, program: Program): TypeNode | undefined {
    const typeNode = getTypeAnnotationNode(declaration);
    if (isPropertyDeclaration(declaration) && typeNode && declaration.questionToken) {
        const typeChecker = program.getTypeChecker();
        const type = typeChecker.getTypeFromTypeNode(typeNode);
        if (!typeChecker.isTypeAssignableTo(typeChecker.getUndefinedType(), type)) {
            const types = isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
            return factory.createUnionTypeNode([...types, factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword)]);
        }
    }
    return typeNode;
}

function isAccessorClassLike(node: Node): node is AccessorClassLike {
    return node.kind === SyntaxKind.ClassDeclaration || node.kind === SyntaxKind.ClassExpression;
}
