/*
 * Copyright (C) 2012-2014 by various contributors (see AUTHORS)
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/

// Transcribed from the bundled Babylon 7.0.0-beta.32 in WebKit/JetStream
// at 3967678fa8ab98d847ab33cf3728dba726fa854b.
// Nodes are built incrementally, as in upstream. These declarations describe
// the unions present in the completed AST; checked readers below narrow fields
// where a grammar production establishes their concrete shape.
export interface RegExpValue { pattern: string; flags: string; value?: NodeValue; }
interface TemplateValue { raw: string; cooked: NodeValue; }
export type NodeValue = string | number | boolean | null | undefined | Node | RegExp | RegExpValue | TemplateValue;
interface NodeExtra { [key: string]: NodeValue; raw?: string; rawValue?: NodeValue; parenthesized?: boolean; parenStart?: number; }
interface TokenConfiguration { keyword?: string; beforeExpr?: boolean; startsExpr?: boolean; rightAssociative?: boolean; isLoop?: boolean; isAssign?: boolean; prefix?: boolean; postfix?: boolean; binop?: number; }
interface Label { kind?: string | null; name?: string; statementStart?: number; }
interface Comment { type: string; value: string; start: number; end: number; loc: SourceLocation; }
interface StartReference { start: number; }
interface FunctionTypeParameters { params: (Node | null)[]; rest: Node | null; }
export class ParserOptions {
  [key: string]: unknown;
  declare sourceType: string;
  declare sourceFilename: string | undefined;
  declare startLine: number;
  declare allowReturnOutsideFunction: boolean;
  declare allowImportExportEverywhere: boolean;
  declare allowSuperOutsideMethod: boolean;
  declare plugins: string[];
  declare strictMode: boolean | null;
  declare ranges: boolean;
  declare tokens: boolean;
}
interface PositionedSyntaxError extends SyntaxError { pos?: number; loc?: Position; missingPlugin?: string[]; }



function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new TypeError("Missing Babylon parser value");
  return value;
}
function nodeValue(value: unknown): Node {
  if (!(value instanceof Node)) throw new TypeError("Expected Babylon syntax node");
  return value;
}
function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected Babylon token string");
  return value;
}
function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new TypeError("Expected Babylon token number");
  return value;
}
function nodeArray(value: Node | Node[]): Node[] {
  if (!Array.isArray(value)) throw new TypeError("Expected Babylon syntax node array");
  return value;
}
function regexpValue(value: NodeValue): RegExpValue {
  if (value !== null && typeof value === "object" && "pattern" in value && typeof value.pattern === "string" && "flags" in value && typeof value.flags === "string") return value;
  throw new TypeError("Expected Babylon regexp token");
}
function removeField<K extends string>(object: { [P in K]?: unknown }, key: K): void {
  delete object[key];
}


interface SubscriptState { stop: boolean; potentialAsync?: boolean; stopCalls?: boolean; }
interface ClassBodyState { hadConstructor: boolean; hadStaticSuper?: boolean; }
interface ArrowReference { start: number; }

interface BaseParser {
  isReservedWord(word: string | Node): boolean;
  hasPlugin(name: string): boolean;
  addComment(comment: Comment): void;
  processComment(node: Node): void;
  raise(pos: number, message: string, missingPluginNames?: string[]): never;
  next(): void;
  eat(type: TokenType): boolean;
  match(type: TokenType): boolean;
  isKeyword(word: string | Node): boolean;
  lookahead(): State;
  setStrict(strict: boolean): void;
  curContext(): TokContext;
  nextToken(): void;
  readToken(code: number): void;
  fullCharCodeAtPos(): number;
  pushComment(block: boolean, text: string, start: number, end: number, startLoc: Position, endLoc: Position): void;
  skipBlockComment(): void;
  skipLineComment(startSkip: number): void;
  skipSpace(): void;
  finishToken(type: TokenType, val?: NodeValue): void;
  readToken_dot(): void;
  readToken_slash(): void;
  readToken_mult_modulo(code: number): void;
  readToken_pipe_amp(code: number): void;
  readToken_caret(): void;
  readToken_plus_min(code: number): void;
  readToken_lt_gt(code: number): void;
  readToken_eq_excl(code: number): void;
  readToken_question(): void;
  getTokenFromCode(code: number): void;
  finishOp(type: TokenType, size: number): void;
  readRegexp(): void;
  readInt(radix: number, len?: number): number | null;
  readRadixNumber(radix: number): void;
  readNumber(startsWithDot: boolean | undefined): void;
  readCodePoint(throwOnInvalid?: boolean): number | null;
  readString(quote: number): void;
  readTmplToken(): void;
  readEscapedChar(inTemplate: boolean | undefined): string | null;
  readHexChar(len: number, throwOnInvalid?: boolean): number | null;
  readWord1(): string;
  readWord(): void;
  braceIsBlock(prevType: TokenType): boolean;
  updateContext(prevType: TokenType): void;
  addExtra(node: Node, key: string, val: NodeValue): void;
  isRelational(op: string): boolean;
  expectRelational(op: string): void;
  eatRelational(op: string): boolean;
  isContextual(name: string): boolean;
  isLookaheadContextual(name: string): boolean;
  eatContextual(name: string): boolean | undefined;
  expectContextual(name: string, message?: string): void;
  canInsertSemicolon(): boolean;
  hasPrecedingLineBreak(): boolean;
  isLineTerminator(): boolean | undefined;
  semicolon(): void;
  expect(type: TokenType, pos?: number | null): void;
  unexpected(pos?: number | null, messageOrType?: string | TokenType): never;
  expectPlugin(name: string, pos?: number): boolean;
  expectOnePlugin(names: string[], pos?: number): void;
  startNode(): Node;
  startNodeAt(pos: number, loc: Position | null | undefined): Node;
  startNodeAtNode(type: Node): Node;
  finishNode(node: Node, type: string | undefined): Node;
  finishNodeAt(node: Node, type: string | undefined, pos: number, loc: Position | null | undefined): Node;
  resetStartLocationFromNode(node: Node, locationNode: Node): void;
  toAssignable(node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null;
  toAssignableObjectExpressionProp(prop: Node, isBinding?: boolean, isLast?: boolean): void;
  toAssignableList(exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[];
  toReferencedList(exprList: (Node | null)[]): (Node | null)[];
  parseSpread(refShorthandDefaultPos: StartReference | undefined): Node;
  parseRest(): Node;
  shouldAllowYieldIdentifier(): boolean;
  parseBindingIdentifier(): Node;
  parseBindingAtom(): Node;
  parseBindingList(close: TokenType, allowEmpty?: boolean, allowModifiers?: boolean): (Node | null)[];
  parseAssignableListItem(allowModifiers?: boolean, decorators?: Node[]): Node;
  parseAssignableListItemTypes(param: Node): Node;
  parseMaybeDefault(startPos?: number, startLoc?: Position | null | undefined, left?: Node): Node;
  checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void;
  checkToRestConversion(node: Node): void;
  checkPropClash(prop: Node, propHash: Record<string, boolean>): void;
  getExpression(): Node;
  parseExpression(noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node;
  parseMaybeAssign(noIn?: boolean, refShorthandDefaultPos?: StartReference, afterLeftParse?: (this: BaseParser, node: Node, startPos: number, startLoc: Position) => Node, refNeedsArrowPos?: StartReference): Node;
  parseMaybeConditional(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos: StartReference | undefined): Node;
  parseConditional(expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position, refNeedsArrowPos?: StartReference): Node;
  parseExprOps(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node;
  parseExprOp(left: Node, leftStartPos: number, leftStartLoc: Position, minPrec: number, noIn: boolean | undefined): Node;
  parseMaybeUnary(refShorthandDefaultPos?: StartReference | undefined): Node;
  parseExprSubscripts(refShorthandDefaultPos?: StartReference | undefined): Node;
  parseSubscripts(base: Node, startPos: number, startLoc: Position, noCalls?: boolean): Node;
  parseSubscript(base: Node, startPos: number, startLoc: Position, noCalls: boolean | undefined, state: SubscriptState): Node;
  atPossibleAsync(base: Node): boolean;
  finishCallExpression(node: Node): Node;
  parseCallExpressionArguments(close: TokenType, possibleAsyncArrow?: boolean, refTrailingCommaPos?: StartReference): (Node | null)[];
  shouldParseAsyncArrow(): boolean;
  parseAsyncArrowFromCallExpression(node: Node, call: Node): Node;
  parseNoCallExpr(): Node;
  parseExprAtom(refShorthandDefaultPos?: StartReference): Node;
  parseBooleanLiteral(): Node;
  parseMaybePrivateName(): Node;
  parseFunctionExpression(): Node;
  parseMetaProperty(node: Node, meta: Node, propertyName: string): Node;
  parseImportMetaProperty(): Node;
  parseLiteral(value: NodeValue, type: string, startPos?: number, startLoc?: Position): Node;
  parseParenExpression(): Node;
  parseParenAndDistinguishExpression(canBeArrow: boolean | undefined): Node;
  shouldParseArrow(): boolean;
  parseArrow(node: Node): Node | undefined;
  parseParenItem(node: Node, startPos?: number, startLoc?: Position): Node;
  parseNew(): Node;
  parseNewArguments(node: Node): void;
  parseTemplateElement(isTagged?: boolean): Node;
  parseTemplate(isTagged?: boolean): Node;
  parseObj(isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node;
  isGetterOrSetterMethod(prop: Node, isPattern: boolean | undefined): boolean | string | undefined;
  checkGetterSetterParamCount(method: Node): void;
  parseObjectMethod(prop: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined): Node | undefined;
  parseObjectProperty(prop: Node, startPos: number | undefined, startLoc: Position | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined;
  parseObjPropValue(prop: Node, startPos: number | undefined, startLoc: Position | undefined, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference): Node | void;
  parsePropertyName(prop: Node): Node;
  initFunction(node: Node, isAsync: boolean | undefined): void;
  parseMethod(node: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean, type?: string): Node;
  parseArrowExpression(node: Node, params: (Node | null)[], isAsync?: boolean | undefined): Node;
  setArrowFunctionParameters(node: Node, params: (Node | null)[]): void;
  isStrictBody(node: Node, isExpression: boolean | Node | null | undefined): boolean;
  parseFunctionBodyAndFinish(node: Node, type: string | undefined, allowExpressionBody?: boolean): void;
  parseFunctionBody(node: Node, allowExpression?: boolean): void;
  checkFunctionNameAndParams(node: Node, isArrowFunction?: boolean): void;
  parseExprList(close: TokenType, allowEmpty?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): (Node | null)[];
  parseExprListItem(allowEmpty: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos?: StartReference | undefined, refTrailingCommaPos?: StartReference): Node | null;
  parseIdentifier(liberal?: boolean | undefined): Node;
  parseIdentifierName(pos: number, liberal?: boolean): string;
  checkReservedWord(word: string | Node, startLoc: number, checkKeywords?: boolean, isBinding?: boolean): void;
  parseAwait(node: Node): Node;
  parseYield(): Node;
  parseTopLevel(file: Node, program: Node): Node;
  stmtToDirective(stmt: Node): Node;
  parseStatement(declaration: boolean | undefined, topLevel?: boolean | undefined): Node;
  parseStatementContent(declaration?: boolean, topLevel?: boolean): Node;
  assertModuleNodeAllowed(node: Node): void;
  takeDecorators(node: Node): void;
  parseDecorators(allowExport?: boolean | undefined): void;
  parseDecorator(): Node;
  parseBreakContinueStatement(node: Node, keyword: string | undefined): Node;
  parseDebuggerStatement(node: Node): Node;
  parseDoStatement(node: Node): Node;
  parseForStatement(node: Node): Node;
  parseFunctionStatement(node: Node): Node;
  parseIfStatement(node: Node): Node;
  parseReturnStatement(node: Node): Node;
  parseSwitchStatement(node: Node): Node;
  parseThrowStatement(node: Node): Node;
  parseTryStatement(node: Node): Node;
  parseVarStatement(node: Node, kind: TokenType): Node;
  parseWhileStatement(node: Node): Node;
  parseWithStatement(node: Node): Node;
  parseEmptyStatement(node: Node): Node;
  parseLabeledStatement(node: Node, maybeName: string, expr: Node): Node;
  parseExpressionStatement(node: Node, expr: Node): Node;
  parseBlock(allowDirectives?: boolean | undefined): Node;
  isValidDirective(stmt: Node): boolean;
  parseBlockBody(node: Node, allowDirectives: boolean | undefined, topLevel: boolean | undefined, end: TokenType): void;
  parseBlockOrModuleBlockBody(body: Node[], directives: Node[] | undefined, topLevel: boolean | undefined, end: TokenType): void;
  parseFor(node: Node, init: Node | null): Node;
  parseForIn(node: Node, init: Node, forAwait: boolean | undefined): Node;
  parseVar(node: Node, isFor: boolean | undefined, kind: TokenType): Node;
  parseVarHead(decl: Node): void;
  parseFunction(node: Node, isStatement: boolean | number, allowExpressionBody?: boolean | undefined, isAsync?: boolean | undefined, optionalId?: boolean | undefined): Node;
  parseFunctionParams(node: Node, allowModifiers?: boolean): void;
  parseClass(node: Node, isStatement: boolean | number, optionalId?: boolean | undefined): Node;
  isClassProperty(): boolean;
  isClassMethod(): boolean;
  isNonstaticConstructor(method: Node): boolean;
  parseClassBody(node: Node): void;
  parseClassMember(classBody: Node, member: Node, state: ClassBodyState): void;
  parseClassMemberWithIsStatic(classBody: Node, member: Node, state: ClassBodyState, isStatic: boolean): void;
  parseClassPropertyName(member: Node): Node;
  pushClassProperty(classBody: Node, prop: Node): void;
  pushClassPrivateProperty(classBody: Node, prop: Node): void;
  pushClassMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean): void;
  pushClassPrivateMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined): void;
  parsePostMemberNameModifiers(methodOrProp: Node): void;
  parseAccessModifier(): string | null | undefined;
  parseClassPrivateProperty(node: Node): Node;
  parseClassProperty(node: Node): Node;
  parseClassId(node: Node, isStatement: boolean | number, optionalId: boolean | undefined): void;
  parseClassSuper(node: Node): void;
  parseExport(node: Node): Node;
  parseExportDeclaration(node?: Node): Node | null;
  isExportDefaultSpecifier(): boolean;
  parseExportSpecifiersMaybe(node: Node): void;
  parseExportFrom(node: Node, expect?: boolean | undefined): void;
  shouldParseExportStar(): boolean;
  parseExportStar(node: Node, allowNamed?: boolean): void;
  shouldParseExportDeclaration(): boolean;
  checkExport(node: Node, checkNames?: boolean | undefined, isDefault?: boolean | undefined): void;
  checkDeclaration(node: Node): void;
  checkDuplicateExports(node: Node, name: string): void;
  raiseDuplicateExportError(node: Node, name: string): never;
  parseExportSpecifiers(): Node[];
  parseImport(node: Node): Node;
  shouldParseDefaultImport(node: Node): boolean;
  parseImportSpecifierLocal(node: Node, specifier: Node, type: string, contextDescription: string): void;
  parseImportSpecifiers(node: Node): void;
  parseImportSpecifier(node: Node): void;
  parse(): Node;
  estreeParseRegExpLiteral(_ref: RegExpValue): Node;
  estreeParseLiteral(value: NodeValue): Node;
  directiveToStmt(directive: Node): Node;
  flowParseTypeInitialiser(tok?: TokenType): Node;
  flowParsePredicate(): Node;
  flowParseTypeAndPredicateInitialiser(): [Node | null, Node | null];
  flowParseDeclareClass(node: Node): Node;
  flowParseDeclareFunction(node: Node): Node;
  flowParseDeclare(node: Node, insideModule?: boolean): Node;
  flowParseDeclareVariable(node: Node): Node;
  flowParseDeclareModule(node: Node): Node;
  flowParseDeclareExportDeclaration(node: Node, insideModule?: boolean): Node;
  flowParseDeclareModuleExports(node: Node): Node;
  flowParseDeclareTypeAlias(node: Node): Node;
  flowParseDeclareOpaqueType(node: Node): Node;
  flowParseDeclareInterface(node: Node): Node;
  flowParseInterfaceish(node: Node): void;
  flowParseInterfaceExtends(): Node;
  flowParseInterface(node: Node): Node;
  checkReservedType(word: string, startLoc: number): void;
  flowParseRestrictedIdentifier(liberal?: boolean | undefined): Node;
  flowParseTypeAlias(node: Node): Node;
  flowParseOpaqueType(node: Node, declare?: boolean): Node;
  flowParseTypeParameter(requireDefault?: boolean): Node;
  flowParseTypeParameterDeclaration(): Node;
  flowParseTypeParameterInstantiation(call?: boolean): Node;
  flowParseObjectPropertyKey(): Node;
  flowParseObjectTypeIndexer(node: Node, isStatic: boolean | undefined, variance: Node | null): Node;
  flowParseObjectTypeMethodish(node: Node): Node;
  flowParseObjectTypeCallProperty(node: Node, isStatic: boolean | undefined): Node;
  flowParseObjectType(allowStatic: boolean | undefined, allowExact: boolean | undefined, allowSpread: boolean | undefined): Node;
  flowParseObjectTypeProperty(node: Node, isStatic: boolean | undefined, variance: Node | null, kind: string, allowSpread?: boolean): Node;
  flowCheckGetterSetterParamCount(property: Node): void;
  flowObjectTypeSemicolon(): void;
  flowParseQualifiedTypeIdentifier(startPos?: number, startLoc?: Position, id?: Node): Node;
  flowParseGenericType(startPos: number, startLoc: Position, id: Node): Node;
  flowParseTypeofType(): Node;
  flowParseTupleType(): Node;
  flowParseFunctionTypeParam(): Node;
  reinterpretTypeAsFunctionTypeParam(type: Node): Node;
  flowParseFunctionTypeParams(params?: (Node | null)[]): FunctionTypeParameters;
  flowIdentToTypeAnnotation(startPos: number, startLoc: Position, node: Node, id: Node): Node;
  flowParsePrimaryType(): Node;
  flowParsePostfixType(): Node;
  flowParsePrefixType(): Node;
  flowParseAnonFunctionWithoutParens(): Node;
  flowParseIntersectionType(): Node;
  flowParseUnionType(): Node;
  flowParseType(): Node;
  flowParseTypeAnnotation(): Node;
  flowParseTypeAnnotatableIdentifier(allowPrimitiveOverride?: boolean): Node;
  typeCastToParameter(node: Node): Node;
  flowParseVariance(): Node | null;
  tryParseConditionalConsequent(): { consequent: Node; failed: boolean; };
  getArrowLikeExpressions(node: Node, disallowInvalid?: boolean): [Node[], Node[]];
  forwardNoArrowParamsConversionAt<T>(node: Node, parse: () => T): T;
  jsxReadToken(): void;
  jsxReadNewLine(normalizeCRLF: boolean | undefined): string;
  jsxReadString(quote: number): void;
  jsxReadEntity(): string;
  jsxReadWord(): void;
  jsxParseIdentifier(): Node;
  jsxParseNamespacedName(): Node;
  jsxParseElementName(): Node;
  jsxParseAttributeValue(): Node;
  jsxParseEmptyExpression(): Node;
  jsxParseSpreadChild(): Node;
  jsxParseExpressionContainer(): Node;
  jsxParseAttribute(): Node;
  jsxParseOpeningElementAt(startPos: number, startLoc: Position): Node;
  jsxParseClosingElementAt(startPos: number, startLoc: Position): Node;
  jsxParseElementAt(startPos: number, startLoc: Position): Node;
  jsxParseElement(): Node;
  tsIsIdentifier(): boolean;
  tsNextTokenCanFollowModifier(): boolean;
  tsParseModifier(allowedModifiers: string[]): string | undefined;
  tsIsListTerminator(kind: string): boolean;
  tsParseList<T>(kind: string, parseElement: () => T): T[];
  tsParseDelimitedList<T>(kind: string, parseElement: () => T): T[];
  tsTryParseDelimitedList<T>(kind: string, parseElement: () => T): T[] | undefined;
  tsParseDelimitedListWorker<T>(kind: string, parseElement: () => T, expectSuccess?: boolean): T[] | undefined;
  tsParseBracketedList<T>(kind: string, parseElement: () => T, bracket: boolean, skipFirstToken?: boolean): T[];
  tsParseEntityName(allowReservedWords?: boolean): Node;
  tsParseTypeReference(): Node;
  tsParseThisTypePredicate(lhs: Node): Node;
  tsParseThisTypeNode(): Node;
  tsParseTypeQuery(): Node;
  tsParseTypeParameter(): Node;
  tsTryParseTypeParameters(): Node | undefined;
  tsParseTypeParameters(): Node;
  tsFillSignature(returnToken: TokenType, signature: Node): void;
  tsParseBindingListForSignature(): (Node | null)[];
  tsParseTypeMemberSemicolon(): void;
  tsParseSignatureMember(kind: string): Node;
  tsIsUnambiguouslyIndexSignature(): boolean;
  tsTryParseIndexSignature(node: Node): Node | undefined;
  tsParsePropertyOrMethodSignature(node: Node, readonly?: boolean): Node;
  tsParseTypeMember(): Node;
  tsIsStartOfConstructSignature(): boolean;
  tsParseTypeLiteral(): Node;
  tsParseObjectTypeMembers(): Node[];
  tsIsStartOfMappedType(): boolean;
  tsParseMappedTypeParameter(): Node;
  tsParseMappedType(): Node;
  tsParseTupleType(): Node;
  tsParseParenthesizedType(): Node;
  tsParseFunctionOrConstructorType(type: string): Node;
  tsParseLiteralTypeNode(): Node;
  tsParseNonArrayType(): Node;
  tsParseArrayTypeOrHigher(): Node;
  tsParseTypeOperator(operator: string): Node;
  tsParseTypeOperatorOrHigher(): Node;
  tsParseUnionOrIntersectionType(kind: string, parseConstituentType: () => Node, operator: TokenType): Node;
  tsParseIntersectionTypeOrHigher(): Node;
  tsParseUnionTypeOrHigher(): Node;
  tsIsStartOfFunctionType(): boolean;
  tsSkipParameterStart(): boolean;
  tsIsUnambiguouslyStartOfFunctionType(): boolean;
  tsParseTypeOrTypePredicateAnnotation(returnToken: TokenType): Node;
  tsTryParseTypeOrTypePredicateAnnotation(): Node | undefined;
  tsTryParseTypeAnnotation(): Node | undefined;
  tsTryParseType(): Node | undefined;
  tsParseTypePredicatePrefix(): Node | undefined;
  tsParseTypeAnnotation(eatColon?: boolean, t?: Node): Node;
  tsParseType(): Node;
  tsParseTypeAssertion(): Node;
  tsTryParseTypeArgumentsInExpression(): Node | undefined;
  tsParseHeritageClause(): Node[];
  tsParseExpressionWithTypeArguments(): Node;
  tsParseInterfaceDeclaration(node: Node): Node;
  tsParseTypeAliasDeclaration(node: Node): Node;
  tsParseEnumMember(): Node;
  tsParseEnumDeclaration(node: Node, isConst?: boolean): Node;
  tsParseModuleBlock(): Node;
  tsParseModuleOrNamespaceDeclaration(node: Node): Node;
  tsParseAmbientExternalModuleDeclaration(node: Node): Node;
  tsParseImportEqualsDeclaration(node: Node, isExport?: boolean): Node;
  tsIsExternalModuleReference(): boolean;
  tsParseModuleReference(): Node;
  tsParseExternalModuleReference(): Node;
  tsLookAhead<T>(f: () => T): T;
  tsTryParseAndCatch<T>(f: () => T): T | undefined;
  tsTryParse<T>(f: () => T): T | undefined;
  nodeWithSamePosition(original: Node, type: string): Node;
  tsTryParseDeclare(nany: Node): Node | undefined;
  tsTryParseExportDeclaration(): Node | undefined;
  tsParseExpressionStatement(node: Node, expr: Node): Node | undefined;
  tsParseDeclaration(node: Node, value: string, next?: boolean): Node | undefined;
  tsTryParseGenericAsyncArrowFunction(startPos: number, startLoc: Position): Node | undefined;
  tsParseTypeArguments(): Node;
  tsIsDeclarationStart(): boolean;
}


// A second optional argument can be given to further configure
// the parser process. These options are recognized:
var defaultOptions: ParserOptions = {
  // Source type ("script" or "module") for different semantics
  sourceType: "script",
  // Source filename.
  sourceFilename: undefined,
  // Line from which to start counting source. Useful for
  // integration with other tools.
  startLine: 1,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program.
  allowImportExportEverywhere: false,
  // TODO
  allowSuperOutsideMethod: false,
  // An array of plugins to enable
  plugins: [],
  // TODO
  strictMode: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // Adds all parsed tokens to a `tokens` property on the `File` node
  tokens: false
}; // Interpret and default an options object

function getOptions(opts?: Partial<ParserOptions>): ParserOptions {
  var options = new ParserOptions();

  for (var key in defaultOptions) {
    options[key] = opts && opts[key] != null ? opts[key] : defaultOptions[key];
  }

  return options;
}

// ## Token types
// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.
// All token type variables start with an underscore, to make them
// easy to recognize.
// The `beforeExpr` property is used to disambiguate between regular
// expressions and divisions. It is set on all token types that can
// be followed by an expression (thus, a slash after them would be a
// regular expression).
//
// `isLoop` marks a keyword as starting a loop, which is important
// to know when parsing a label, in order to allow or disallow
// continue jumps to that label.
var beforeExpr = true;
var startsExpr = true;
var isLoop = true;
var isAssign = true;
var prefix = true;
var postfix = true;
class TokenType {
  declare label: string;
  declare keyword: string | undefined;
  declare beforeExpr: boolean;
  declare startsExpr: boolean;
  declare rightAssociative: boolean;
  declare isLoop: boolean;
  declare isAssign: boolean;
  declare prefix: boolean;
  declare postfix: boolean;
  declare binop: number | null;
  declare updateContext: ((this: BaseParser, previous: TokenType) => void) | null;
constructor(label: string, conf?: TokenConfiguration) {
  if (conf === void 0) {
    conf = {};
  }

  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.rightAssociative = !!conf.rightAssociative;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop === 0 ? 0 : conf.binop || null;
  this.updateContext = null;
}
}

class KeywordTokenType extends TokenType {
  

  constructor(name: string, options?: TokenConfiguration) {
    if (options === void 0) {
      options = {};
    }

    options.keyword = name;
    super(name, options);
  }

  
}

class BinopTokenType extends TokenType {
  

  constructor(name: string, prec: number) {
    super(name, {
      beforeExpr,
      binop: prec
    });
  }

  
}
var types: Record<string, TokenType> = {
  num: new TokenType("num", {
    startsExpr
  }),
  bigint: new TokenType("bigint", {
    startsExpr
  }),
  regexp: new TokenType("regexp", {
    startsExpr
  }),
  string: new TokenType("string", {
    startsExpr
  }),
  name: new TokenType("name", {
    startsExpr
  }),
  eof: new TokenType("eof"),
  // Punctuation token types.
  bracketL: new TokenType("[", {
    beforeExpr,
    startsExpr
  }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", {
    beforeExpr,
    startsExpr
  }),
  braceBarL: new TokenType("{|", {
    beforeExpr,
    startsExpr
  }),
  braceR: new TokenType("}"),
  braceBarR: new TokenType("|}"),
  parenL: new TokenType("(", {
    beforeExpr,
    startsExpr
  }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", {
    beforeExpr
  }),
  semi: new TokenType(";", {
    beforeExpr
  }),
  colon: new TokenType(":", {
    beforeExpr
  }),
  doubleColon: new TokenType("::", {
    beforeExpr
  }),
  dot: new TokenType("."),
  question: new TokenType("?", {
    beforeExpr
  }),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", {
    beforeExpr
  }),
  template: new TokenType("template"),
  ellipsis: new TokenType("...", {
    beforeExpr
  }),
  backQuote: new TokenType("`", {
    startsExpr
  }),
  dollarBraceL: new TokenType("${", {
    beforeExpr,
    startsExpr
  }),
  at: new TokenType("@"),
  hash: new TokenType("#"),
  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.
  eq: new TokenType("=", {
    beforeExpr,
    isAssign
  }),
  assign: new TokenType("_=", {
    beforeExpr,
    isAssign
  }),
  incDec: new TokenType("++/--", {
    prefix,
    postfix,
    startsExpr
  }),
  bang: new TokenType("!", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  tilde: new TokenType("~", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  pipeline: new BinopTokenType("|>", 0),
  nullishCoalescing: new BinopTokenType("??", 1),
  logicalOR: new BinopTokenType("||", 1),
  logicalAND: new BinopTokenType("&&", 2),
  bitwiseOR: new BinopTokenType("|", 3),
  bitwiseXOR: new BinopTokenType("^", 4),
  bitwiseAND: new BinopTokenType("&", 5),
  equality: new BinopTokenType("==/!=", 6),
  relational: new BinopTokenType("</>", 7),
  bitShift: new BinopTokenType("<</>>", 8),
  plusMin: new TokenType("+/-", {
    beforeExpr,
    binop: 9,
    prefix,
    startsExpr
  }),
  modulo: new BinopTokenType("%", 10),
  star: new BinopTokenType("*", 10),
  slash: new BinopTokenType("/", 10),
  exponent: new TokenType("**", {
    beforeExpr,
    binop: 11,
    rightAssociative: true
  })
};
var keywords: Record<string, TokenType> = {
  break: new KeywordTokenType("break"),
  case: new KeywordTokenType("case", {
    beforeExpr
  }),
  catch: new KeywordTokenType("catch"),
  continue: new KeywordTokenType("continue"),
  debugger: new KeywordTokenType("debugger"),
  default: new KeywordTokenType("default", {
    beforeExpr
  }),
  do: new KeywordTokenType("do", {
    isLoop,
    beforeExpr
  }),
  else: new KeywordTokenType("else", {
    beforeExpr
  }),
  finally: new KeywordTokenType("finally"),
  for: new KeywordTokenType("for", {
    isLoop
  }),
  function: new KeywordTokenType("function", {
    startsExpr
  }),
  if: new KeywordTokenType("if"),
  return: new KeywordTokenType("return", {
    beforeExpr
  }),
  switch: new KeywordTokenType("switch"),
  throw: new KeywordTokenType("throw", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  try: new KeywordTokenType("try"),
  var: new KeywordTokenType("var"),
  let: new KeywordTokenType("let"),
  const: new KeywordTokenType("const"),
  while: new KeywordTokenType("while", {
    isLoop
  }),
  with: new KeywordTokenType("with"),
  new: new KeywordTokenType("new", {
    beforeExpr,
    startsExpr
  }),
  this: new KeywordTokenType("this", {
    startsExpr
  }),
  super: new KeywordTokenType("super", {
    startsExpr
  }),
  class: new KeywordTokenType("class"),
  extends: new KeywordTokenType("extends", {
    beforeExpr
  }),
  export: new KeywordTokenType("export"),
  import: new KeywordTokenType("import", {
    startsExpr
  }),
  yield: new KeywordTokenType("yield", {
    beforeExpr,
    startsExpr
  }),
  null: new KeywordTokenType("null", {
    startsExpr
  }),
  true: new KeywordTokenType("true", {
    startsExpr
  }),
  false: new KeywordTokenType("false", {
    startsExpr
  }),
  in: new KeywordTokenType("in", {
    beforeExpr,
    binop: 7
  }),
  instanceof: new KeywordTokenType("instanceof", {
    beforeExpr,
    binop: 7
  }),
  typeof: new KeywordTokenType("typeof", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  void: new KeywordTokenType("void", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  delete: new KeywordTokenType("delete", {
    beforeExpr,
    prefix,
    startsExpr
  })
}; // Map keyword names to token types.

Object.keys(keywords).forEach(function (name) {
  types["_" + name] = keywords[name];
});

/* eslint max-len: 0 */
function makePredicate(words: string): (str: string | Node) => boolean {
  var wordsArr: (string | Node)[] = words.split(" ");
  return function (str) {
    return wordsArr.indexOf(str) >= 0;
  };
} // Reserved word lists for various dialects of the language


var reservedWords = {
  "6": makePredicate("enum await"),
  strict: makePredicate("implements interface let package private protected public static yield"),
  strictBind: makePredicate("eval arguments")
}; // And the keywords

var isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this let const class extends export import yield super"); // ## Character categories
// Big ugly regular expressions that match characters in the
// whitespace, identifier, and identifier-start categories. These
// are only applied when a character is found to actually have a
// code point above 128.
// Generated by `bin/generate-identifier-regex.js`.

var nonASCIIidentifierStartChars: string | null = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0-\u08b4\u08b6-\u08bd\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fd5\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7ae\ua7b0-\ua7b7\ua7f7-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab65\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
var nonASCIIidentifierChars: string | null = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d4-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c03\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d01-\u0d03\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf2-\u1cf4\u1cf8\u1cf9\u1dc0-\u1df5\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua900-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";
var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
nonASCIIidentifierStartChars = nonASCIIidentifierChars = null; // These are a run-length and offset encoded representation of the
// >0xffff code points that are a valid part of identifiers. The
// offset starts at 0x10000, and each pair of numbers represents an
// offset to the next range, and then a size of the range. They were
// generated by `bin/generate-identifier-regex.js`.
// eslint-disable-next-line comma-spacing

/* prettier-ignore */

var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 17, 26, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 157, 310, 10, 21, 11, 7, 153, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 26, 45, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 785, 52, 76, 44, 33, 24, 27, 35, 42, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 85, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 159, 52, 19, 3, 54, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 86, 25, 391, 63, 32, 0, 449, 56, 264, 8, 2, 36, 18, 0, 50, 29, 881, 921, 103, 110, 18, 195, 2749, 1070, 4050, 582, 8634, 568, 8, 30, 114, 29, 19, 47, 17, 3, 32, 20, 6, 18, 881, 68, 12, 0, 67, 12, 65, 0, 32, 6124, 20, 754, 9486, 1, 3071, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 4149, 196, 60, 67, 1213, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42710, 42, 4148, 12, 221, 3, 5761, 10591, 541]; // eslint-disable-next-line comma-spacing

/* prettier-ignore */

var astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 1306, 2, 54, 14, 32, 9, 16, 3, 46, 10, 54, 9, 7, 2, 37, 13, 2, 9, 52, 0, 13, 2, 49, 13, 10, 2, 4, 9, 83, 11, 7, 0, 161, 11, 6, 9, 7, 3, 57, 0, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 193, 17, 10, 9, 87, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 84, 14, 5, 9, 423, 9, 838, 7, 2, 7, 17, 9, 57, 21, 2, 13, 19882, 9, 135, 4, 60, 6, 26, 9, 1016, 45, 17, 3, 19723, 1, 5319, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 2214, 6, 110, 6, 6, 9, 792487, 239]; // This has a complexity linear to the value of the code. The
// assumption is that looking up astral identifier characters is
// rare.

function isInAstralSet(code: number, set: number[]): boolean {
  var pos = 0x10000;

  for (var i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) return false;
    pos += set[i + 1];
    if (pos >= code) return true;
  }

  return false;
} // Test whether a given character code starts an identifier.


function isIdentifierStart(code: number): boolean {
  if (code < 65) return code === 36;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;

  if (code <= 0xffff) {
    return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
  }

  return isInAstralSet(code, astralIdentifierStartCodes);
} // Test whether a given character is part of an identifier.

function isIdentifierChar(code: number, _astral?: boolean): boolean {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;

  if (code <= 0xffff) {
    return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
  }

  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}

// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.
var lineBreak = /\r\n?|\n|\u2028|\u2029/;
var lineBreakG = new RegExp(lineBreak.source, "g");
function isNewLine(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}
var nonASCIIwhitespace = /[\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

// The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design
class TokContext {
  declare token: string;
  declare isExpr: boolean;
  declare preserveSpace: boolean;
  declare override: ((parser: BaseParser) => void) | undefined;
constructor(token: string, isExpr: boolean, preserveSpace?: boolean, override?: (parser: BaseParser) => void) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
}
}
var types$1: Record<string, TokContext> = {
  braceStatement: new TokContext("{", false),
  braceExpression: new TokContext("{", true),
  templateQuasi: new TokContext("${", true),
  parenStatement: new TokContext("(", false),
  parenExpression: new TokContext("(", true),
  template: new TokContext("`", true, true, function (p) {
    return p.readTmplToken();
  }),
  functionExpression: new TokContext("function", true)
}; // Token-specific context update code

types.parenR.updateContext = types.braceR.updateContext = function () {
  if (this.state.context.length === 1) {
    this.state.exprAllowed = true;
    return;
  }

  var out = this.state.context.pop();

  if (out === types$1.braceStatement && this.curContext() === types$1.functionExpression) {
    this.state.context.pop();
    this.state.exprAllowed = false;
  } else if (out === types$1.templateQuasi) {
    this.state.exprAllowed = true;
  } else {
    this.state.exprAllowed = !out!.isExpr;
  }
};

types.name.updateContext = function (prevType) {
  if (this.state.value === "of" && this.curContext() === types$1.parenStatement) {
    this.state.exprAllowed = !prevType.beforeExpr;
    return;
  }

  this.state.exprAllowed = false;

  if (prevType === types._let || prevType === types._const || prevType === types._var) {
    if (lineBreak.test(this.input.slice(this.state.end))) {
      this.state.exprAllowed = true;
    }
  }
};

types.braceL.updateContext = function (prevType) {
  this.state.context.push(this.braceIsBlock(prevType) ? types$1.braceStatement : types$1.braceExpression);
  this.state.exprAllowed = true;
};

types.dollarBraceL.updateContext = function () {
  this.state.context.push(types$1.templateQuasi);
  this.state.exprAllowed = true;
};

types.parenL.updateContext = function (prevType) {
  var statementParens = prevType === types._if || prevType === types._for || prevType === types._with || prevType === types._while;
  this.state.context.push(statementParens ? types$1.parenStatement : types$1.parenExpression);
  this.state.exprAllowed = true;
};

types.incDec.updateContext = function () {// tokExprAllowed stays unchanged
};

types._function.updateContext = function () {
  if (this.curContext() !== types$1.braceStatement) {
    this.state.context.push(types$1.functionExpression);
  }

  this.state.exprAllowed = false;
};

types.backQuote.updateContext = function () {
  if (this.curContext() === types$1.template) {
    this.state.context.pop();
  } else {
    this.state.context.push(types$1.template);
  }

  this.state.exprAllowed = false;
};

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.
class Position {
  declare line: number;
  declare column: number;
constructor(line: number, col: number) {
  this.line = line;
  this.column = col;
}
}
class SourceLocation {
  declare start: Position;
  declare end: Position | null | undefined;
  declare filename?: string;
  declare identifierName?: string | Node | null;
constructor(start?: Position, end?: Position | null) {
  this.start = start!; // $FlowIgnore (may start as null, but initialized later)

  this.end = end;
}
} // The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

function getLineInfo(input: string, offset: number): Position {
  for (var line = 1, cur = 0;;) {
    lineBreakG.lastIndex = cur;
    var match = lineBreakG.exec(input);

    if (match && match.index < offset) {
      ++line;
      cur = match.index + match[0].length;
    } else {
      return new Position(line, offset - cur);
    }
  } // istanbul ignore next


  throw new Error("Unreachable");
}

class BaseParser {
  declare state: State;
  declare options: ParserOptions;
  declare inModule: boolean;
  declare input: string;
  declare plugins: Record<string, boolean>;
  declare filename: string | undefined;
  declare isLookahead: boolean | undefined;
  
  declare sawUnambiguousESM: boolean;

  constructor() {}

  

  // Properties set by constructor in index.js
  // Initialized by Tokenizer
  isReservedWord(word: string | Node): boolean {
    if (word === "await") {
      return this.inModule;
    } else {
      return reservedWords[6](word);
    }
  }

  hasPlugin(name: string): boolean {
    return !!this.plugins[name];
  }

  
}

/* eslint max-len: 0 */

/**
 * Based on the comment attachment algorithm used in espree and estraverse.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer.
 * * Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function last<T>(stack: T[]): T {
  return stack[stack.length - 1];
}

class CommentsParser extends BaseParser {
  

  

  

  addComment(comment: Comment): void {
    if (this.filename) comment.loc.filename = this.filename;
    this.state.trailingComments.push(comment);
    this.state.leadingComments.push(comment);
  }

  processComment(node: Node): void {
    if (node.type === "Program" && nodeArray(node.body).length > 0) return;
    var stack = this.state.commentStack;
    var firstChild, lastChild, trailingComments, i, j;

    if (this.state.trailingComments.length > 0) {
      // If the first comment in trailingComments comes after the
      // current node, then we're good - all comments in the array will
      // come after the node and so it's safe to add them as official
      // trailingComments.
      if (this.state.trailingComments[0].start >= node.end) {
        trailingComments = this.state.trailingComments;
        this.state.trailingComments = [];
      } else {
        // Otherwise, if the first comment doesn't come after the
        // current node, that means we have a mix of leading and trailing
        // comments in the array and that leadingComments contains the
        // same items as trailingComments. Reset trailingComments to
        // zero items and we'll handle this by evaluating leadingComments
        // later.
        this.state.trailingComments.length = 0;
      }
    } else {
      if (stack.length > 0) {
        var lastInStack = last(stack);

        if (lastInStack.trailingComments && lastInStack.trailingComments[0].start >= node.end) {
          trailingComments = lastInStack.trailingComments;
          lastInStack.trailingComments = null;
        }
      }
    } // Eating the stack.


    if (stack.length > 0 && last(stack).start >= node.start) {
      firstChild = stack.pop();
    }

    while (stack.length > 0 && last(stack).start >= node.start) {
      lastChild = stack.pop();
    }

    if (!lastChild && firstChild) lastChild = firstChild; // Attach comments that follow a trailing comma on the last
    // property in an object literal or a trailing comma in function arguments
    // as trailing comments

    if (firstChild && this.state.leadingComments.length > 0) {
      var lastComment = last(this.state.leadingComments);

      if (firstChild.type === "ObjectProperty") {
        if (lastComment.start >= node.start) {
          if (this.state.commentPreviousNode) {
            for (j = 0; j < this.state.leadingComments.length; j++) {
              if (this.state.leadingComments[j].end < this.state.commentPreviousNode.end) {
                this.state.leadingComments.splice(j, 1);
                j--;
              }
            }

            if (this.state.leadingComments.length > 0) {
              firstChild.trailingComments = this.state.leadingComments;
              this.state.leadingComments = [];
            }
          }
        }
      } else if (node.type === "CallExpression" && node.arguments && node.arguments.length) {
        var lastArg = last(node.arguments);

        if (lastArg && lastComment.start >= lastArg.start && lastComment.end <= node.end) {
          if (this.state.commentPreviousNode) {
            if (this.state.leadingComments.length > 0) {
              lastArg.trailingComments = this.state.leadingComments;
              this.state.leadingComments = [];
            }
          }
        }
      }
    }

    if (lastChild) {
      if (lastChild.leadingComments) {
        if (lastChild !== node && lastChild.leadingComments.length > 0 && last(lastChild.leadingComments).end <= node.start) {
          node.leadingComments = lastChild.leadingComments;
          lastChild.leadingComments = null;
        } else {
          // A leading comment for an anonymous class had been stolen by its first ClassMethod,
          // so this takes back the leading comment.
          // See also: https://github.com/eslint/espree/issues/158
          for (i = lastChild.leadingComments.length - 2; i >= 0; --i) {
            if (lastChild.leadingComments[i].end <= node.start) {
              node.leadingComments = lastChild.leadingComments.splice(0, i + 1);
              break;
            }
          }
        }
      }
    } else if (this.state.leadingComments.length > 0) {
      if (last(this.state.leadingComments).end <= node.start) {
        if (this.state.commentPreviousNode) {
          for (j = 0; j < this.state.leadingComments.length; j++) {
            if (this.state.leadingComments[j].end < this.state.commentPreviousNode.end) {
              this.state.leadingComments.splice(j, 1);
              j--;
            }
          }
        }

        if (this.state.leadingComments.length > 0) {
          node.leadingComments = this.state.leadingComments;
          this.state.leadingComments = [];
        }
      } else {
        // https://github.com/eslint/espree/issues/2
        //
        // In special cases, such as return (without a value) and
        // debugger, all comments will end up as leadingComments and
        // will otherwise be eliminated. This step runs when the
        // commentStack is empty and there are comments left
        // in leadingComments.
        //
        // This loop figures out the stopping point between the actual
        // leading and trailing comments by finding the location of the
        // first comment that comes after the given node.
        for (i = 0; i < this.state.leadingComments.length; i++) {
          if (this.state.leadingComments[i].end > node.start) {
            break;
          }
        } // Split the array based on the location of the first comment
        // that comes after the node. Keep in mind that this could
        // result in an empty array, and if so, the array must be
        // deleted.


        var leadingComments = this.state.leadingComments.slice(0, i);
        node.leadingComments = leadingComments.length === 0 ? null : leadingComments; // Similarly, trailing comments are attached later. The variable
        // must be reset to null if there are no trailing comments.

        trailingComments = this.state.leadingComments.slice(i);

        if (trailingComments.length === 0) {
          trailingComments = null;
        }
      }
    }

    this.state.commentPreviousNode = node;

    if (trailingComments) {
      if (trailingComments.length && trailingComments[0].start >= node.start && last(trailingComments).end <= node.end) {
        node.innerComments = trailingComments;
      } else {
        node.trailingComments = trailingComments;
      }
    }

    stack.push(node);
  }

  
}

// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

class LocationParser extends CommentsParser {
  

  

  

  raise(pos: number, message: string, missingPluginNames?: string[]): never {
    var loc = getLineInfo(this.input, pos);
    message += ` (${loc.line}:${loc.column})`; // $FlowIgnore

    var err: PositionedSyntaxError = new SyntaxError(message);
    err.pos = pos;
    err.loc = loc;

    if (missingPluginNames) {
      err.missingPlugin = missingPluginNames;
    }

    throw err;
  }

  
}

class State {
  [key: string]: unknown;
  declare strict: boolean;
  declare input: string;
  declare potentialArrowAt: number;
  declare inMethod: boolean | string | undefined;
  declare inFunction: boolean | undefined;
  declare inGenerator: boolean | undefined;
  declare inAsync: boolean | undefined;
  declare inPropertyName: boolean | undefined;
  declare inType: boolean;
  declare noAnonFunctionType: boolean;
  declare labels: Label[];
  declare decorators: Node[];
  declare tokens: (Token | Comment)[];
  declare comments: Comment[];
  declare trailingComments: Comment[];
  declare leadingComments: Comment[];
  declare commentStack: Node[];
  declare pos: number;
  declare lineStart: number;
  declare curLine: number;
  declare type: TokenType;
  declare value: NodeValue;
  declare start: number;
  declare end: number;
  declare startLoc: Position;
  declare endLoc: Position;
  declare lastTokEndLoc: Position | null;
  declare lastTokStartLoc: Position | null;
  declare lastTokStart: number;
  declare lastTokEnd: number;
  declare context: TokContext[];
  declare exprAllowed: boolean;
  declare containsEsc: boolean;
  declare containsOctal: boolean;
  declare octalPosition: number | null;
  declare invalidTemplateEscapePosition: number | null;
  declare exportedIdentifiers: string[];
  declare commentPreviousNode: Node | null | undefined;
  declare noArrowAt: number[];
  declare noArrowParamsConversionAt: number[];
  declare inParameters: boolean;
  declare maybeInArrowParameters: boolean;
  declare inClassProperty: boolean;
  declare classLevel: number;
  declare decoratorStack: Node[][];
  declare yieldInPossibleArrowParameters: Node | null;

  constructor() {}

  

  init(options: ParserOptions, input: string): void {
    this.strict = options.strictMode === false ? false : options.sourceType === "module";
    this.input = input;
    this.potentialArrowAt = -1;
    this.noArrowAt = [];
    this.noArrowParamsConversionAt = []; // eslint-disable-next-line max-len

    this.inMethod = this.inFunction = this.inParameters = this.maybeInArrowParameters = this.inGenerator = this.inAsync = this.inPropertyName = this.inType = this.inClassProperty = this.noAnonFunctionType = false;
    this.classLevel = 0;
    this.labels = [];
    this.decoratorStack = [[]];
    this.yieldInPossibleArrowParameters = null;
    this.tokens = [];
    this.comments = [];
    this.trailingComments = [];
    this.leadingComments = [];
    this.commentStack = []; // $FlowIgnore

    this.commentPreviousNode = null;
    this.pos = this.lineStart = 0;
    this.curLine = options.startLine;
    this.type = types.eof;
    this.value = null;
    this.start = this.end = this.pos;
    this.startLoc = this.endLoc = this.curPosition(); // $FlowIgnore

    this.lastTokEndLoc = this.lastTokStartLoc = null;
    this.lastTokStart = this.lastTokEnd = this.pos;
    this.context = [types$1.braceStatement];
    this.exprAllowed = true;
    this.containsEsc = this.containsOctal = false;
    this.octalPosition = null;
    this.invalidTemplateEscapePosition = null;
    this.exportedIdentifiers = [];
  } // TODO


  curPosition(): Position {
    return new Position(this.curLine, this.pos - this.lineStart);
  }

  clone(skipArrays?: boolean | undefined): State {
    var _this = this;

    var state = new State();
    Object.keys(this).forEach(function (key) {
      // $FlowIgnore
      var val = _this[key];

      if ((!skipArrays || key === "context") && Array.isArray(val)) {
        val = val.slice();
      } // $FlowIgnore


      state[key] = val;
    });
    return state;
  }

  
}

/* eslint max-len: 0 */
// an immediate sibling of NumericLiteralSeparator _

var forbiddenNumericSeparatorSiblings = {
  decBinOct: [46, // .
  66, // B
  69, // E
  79, // O
  95, // _ (multiple separators are not allowed)
  98, // b
  101, // e
  111],
  hex: [46, // .
  88, // X
  95, // _ (multiple separators are not allowed)
  120]
};
var allowedNumericSeparatorSiblings: Record<string, number[]> = {};
allowedNumericSeparatorSiblings.bin = [// 0 - 1
48, 49];
allowedNumericSeparatorSiblings.oct = new Array<number>().concat(allowedNumericSeparatorSiblings.bin, [50, 51, 52, 53, 54, 55]);
allowedNumericSeparatorSiblings.dec = new Array<number>().concat(allowedNumericSeparatorSiblings.oct, [56, 57]);
allowedNumericSeparatorSiblings.hex = new Array<number>().concat(allowedNumericSeparatorSiblings.dec, [// A - F
65, 66, 67, 68, 69, 70, // a - f
97, 98, 99, 100, 101, 102]); // Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

class Token {
  declare type: TokenType;
  declare value: NodeValue;
  declare start: number;
  declare end: number;
  declare loc: SourceLocation;
constructor(state: State) {
  this.type = state.type;
  this.value = state.value;
  this.start = state.start;
  this.end = state.end;
  this.loc = new SourceLocation(state.startLoc, state.endLoc);
}
} // ## Tokenizer

function codePointToString(code: number): string {
  // UTF-16 Decoding
  if (code <= 0xffff) {
    return String.fromCharCode(code);
  } else {
    return String.fromCharCode((code - 0x10000 >> 10) + 0xd800, (code - 0x10000 & 1023) + 0xdc00);
  }
}

class Tokenizer extends LocationParser {
  

  // Forward-declarations
  // parser/util.js
  constructor(options: ParserOptions, input: string) {
    super();
    this.state = new State();

    this.state.init(options, input);

    this.isLookahead = false;
} // Move to the next token


  

  next(): void {
    if (this.options.tokens && !this.isLookahead) {
      this.state.tokens.push(new Token(this.state));
    }

    this.state.lastTokEnd = this.state.end;
    this.state.lastTokStart = this.state.start;
    this.state.lastTokEndLoc = this.state.endLoc;
    this.state.lastTokStartLoc = this.state.startLoc;
    this.nextToken();
  } // TODO


  eat(type: TokenType): boolean {
    if (this.match(type)) {
      this.next();
      return true;
    } else {
      return false;
    }
  } // TODO


  match(type: TokenType): boolean {
    return this.state.type === type;
  } // TODO


  isKeyword(word: string | Node): boolean {
    return isKeyword(word);
  } // TODO


  lookahead(): State {
    var old = this.state;
    this.state = old.clone(true);
    this.isLookahead = true;
    this.next();
    this.isLookahead = false;
    var curr = this.state;
    this.state = old;
    return curr;
  } // Toggle strict mode. Re-reads the next number or string to please
  // pedantic tests (`"use strict"; 010;` should fail).


  setStrict(strict: boolean): void {
    this.state.strict = strict;
    if (!this.match(types.num) && !this.match(types.string)) return;
    this.state.pos = this.state.start;

    while (this.state.pos < this.state.lineStart) {
      this.state.lineStart = this.input.lastIndexOf("\n", this.state.lineStart - 2) + 1;
      --this.state.curLine;
    }

    this.nextToken();
  }

  curContext(): TokContext {
    return this.state.context[this.state.context.length - 1];
  } // Read a single token, updating the parser object's token-related
  // properties.


  nextToken(): void {
    var curContext = this.curContext();
    if (!curContext || !curContext.preserveSpace) this.skipSpace();
    this.state.containsOctal = false;
    this.state.octalPosition = null;
    this.state.start = this.state.pos;
    this.state.startLoc = this.state.curPosition();

    if (this.state.pos >= this.input.length) {
      this.finishToken(types.eof);
      return;
    }

    if (curContext.override) {
      curContext.override(this);
    } else {
      this.readToken(this.fullCharCodeAtPos());
    }
  }

  readToken(code: number): void {
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code) || code === 92
    /* '\' */
    ) {
        this.readWord();
      } else {
      this.getTokenFromCode(code);
    }
  }

  fullCharCodeAtPos(): number {
    var code = this.input.charCodeAt(this.state.pos);
    if (code <= 0xd7ff || code >= 0xe000) return code;
    var next = this.input.charCodeAt(this.state.pos + 1);
    return (code << 10) + next - 0x35fdc00;
  }

  pushComment(block: boolean, text: string, start: number, end: number, startLoc: Position, endLoc: Position): void {
    var comment = {
      type: block ? "CommentBlock" : "CommentLine",
      value: text,
      start: start,
      end: end,
      loc: new SourceLocation(startLoc, endLoc)
    };

    if (!this.isLookahead) {
      if (this.options.tokens) this.state.tokens.push(comment);
      this.state.comments.push(comment);
      this.addComment(comment);
    }
  }

  skipBlockComment(): void {
    var startLoc = this.state.curPosition();
    var start = this.state.pos;
    var end = this.input.indexOf("*/", this.state.pos += 2);
    if (end === -1) this.raise(this.state.pos - 2, "Unterminated comment");
    this.state.pos = end + 2;
    lineBreakG.lastIndex = start;
    var match;

    while ((match = lineBreakG.exec(this.input)) && match.index < this.state.pos) {
      ++this.state.curLine;
      this.state.lineStart = match.index + match[0].length;
    }

    this.pushComment(true, this.input.slice(start + 2, end), start, this.state.pos, startLoc, this.state.curPosition());
  }

  skipLineComment(startSkip: number): void {
    var start = this.state.pos;
    var startLoc = this.state.curPosition();
    var ch = this.input.charCodeAt(this.state.pos += startSkip);

    if (this.state.pos < this.input.length) {
      while (ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8233 && ++this.state.pos < this.input.length) {
        ch = this.input.charCodeAt(this.state.pos);
      }
    }

    this.pushComment(false, this.input.slice(start + startSkip, this.state.pos), start, this.state.pos, startLoc, this.state.curPosition());
  } // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.


  skipSpace(): void {
    loop: while (this.state.pos < this.input.length) {
      var ch = this.input.charCodeAt(this.state.pos);

      switch (ch) {
        case 32: // space

        case 160:
          // non-breaking space
          ++this.state.pos;
          break;

        case 13:
          // '\r' carriage return
          if (this.input.charCodeAt(this.state.pos + 1) === 10) {
            ++this.state.pos;
          }

        case 10: // '\n' line feed

        case 8232: // line separator

        case 8233:
          // paragraph separator
          ++this.state.pos;
          ++this.state.curLine;
          this.state.lineStart = this.state.pos;
          break;

        case 47:
          // '/'
          switch (this.input.charCodeAt(this.state.pos + 1)) {
            case 42:
              // '*'
              this.skipBlockComment();
              break;

            case 47:
              this.skipLineComment(2);
              break;

            default:
              break loop;
          }

          break;

        default:
          if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
            ++this.state.pos;
          } else {
            break loop;
          }

      }
    }
  } // Called at the end of every token. Sets `end`, `val`, and
  // maintains `context` and `exprAllowed`, and skips the space after
  // the token, so that the next one's `start` will point at the
  // right position.


  finishToken(type: TokenType, val?: NodeValue): void {
    this.state.end = this.state.pos;
    this.state.endLoc = this.state.curPosition();
    var prevType = this.state.type;
    this.state.type = type;
    this.state.value = val;
    this.updateContext(prevType);
  } // ### Token reading
  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //


  readToken_dot(): void {
    var next = this.input.charCodeAt(this.state.pos + 1);

    if (next >= 48 && next <= 57) {
      this.readNumber(true);
      return;
    }

    var next2 = this.input.charCodeAt(this.state.pos + 2);

    if (next === 46 && next2 === 46) {
      // 46 = dot '.'
      this.state.pos += 3;
      this.finishToken(types.ellipsis);
    } else {
      ++this.state.pos;
      this.finishToken(types.dot);
    }
  }

  readToken_slash(): void {
    // '/'
    if (this.state.exprAllowed) {
      ++this.state.pos;
      this.readRegexp();
      return;
    }

    var next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 61) {
      this.finishOp(types.assign, 2);
    } else {
      this.finishOp(types.slash, 1);
    }
  }

  readToken_mult_modulo(code: number): void {
    // '%*'
    var type = code === 42 ? types.star : types.modulo;
    var width = 1;
    var next = this.input.charCodeAt(this.state.pos + 1);
    var exprAllowed = this.state.exprAllowed; // Exponentiation operator **

    if (code === 42 && next === 42) {
      width++;
      next = this.input.charCodeAt(this.state.pos + 2);
      type = types.exponent;
    }

    if (next === 61 && !exprAllowed) {
      width++;
      type = types.assign;
    }

    this.finishOp(type, width);
  }

  readToken_pipe_amp(code: number): void {
    // '|&'
    var next = this.input.charCodeAt(this.state.pos + 1);

    if (next === code) {
      this.finishOp(code === 124 ? types.logicalOR : types.logicalAND, 2);
      return;
    }

    if (code === 124) {
      // '|>'
      if (next === 62) {
        this.finishOp(types.pipeline, 2);
        return;
      } else if (next === 125 && this.hasPlugin("flow")) {
        // '|}'
        this.finishOp(types.braceBarR, 2);
        return;
      }
    }

    if (next === 61) {
      this.finishOp(types.assign, 2);
      return;
    }

    this.finishOp(code === 124 ? types.bitwiseOR : types.bitwiseAND, 1);
  }

  readToken_caret(): void {
    // '^'
    var next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 61) {
      this.finishOp(types.assign, 2);
    } else {
      this.finishOp(types.bitwiseXOR, 1);
    }
  }

  readToken_plus_min(code: number): void {
    // '+-'
    var next = this.input.charCodeAt(this.state.pos + 1);

    if (next === code) {
      if (next === 45 && !this.inModule && this.input.charCodeAt(this.state.pos + 2) === 62 && lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.pos))) {
        // A `-->` line comment
        this.skipLineComment(3);
        this.skipSpace();
        this.nextToken();
        return;
      }

      this.finishOp(types.incDec, 2);
      return;
    }

    if (next === 61) {
      this.finishOp(types.assign, 2);
    } else {
      this.finishOp(types.plusMin, 1);
    }
  }

  readToken_lt_gt(code: number): void {
    // '<>'
    var next = this.input.charCodeAt(this.state.pos + 1);
    var size = 1;

    if (next === code) {
      size = code === 62 && this.input.charCodeAt(this.state.pos + 2) === 62 ? 3 : 2;

      if (this.input.charCodeAt(this.state.pos + size) === 61) {
        this.finishOp(types.assign, size + 1);
        return;
      }

      this.finishOp(types.bitShift, size);
      return;
    }

    if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.state.pos + 2) === 45 && this.input.charCodeAt(this.state.pos + 3) === 45) {
      // `<!--`, an XML-style comment that should be interpreted as a line comment
      this.skipLineComment(4);
      this.skipSpace();
      this.nextToken();
      return;
    }

    if (next === 61) {
      // <= | >=
      size = 2;
    }

    this.finishOp(types.relational, size);
  }

  readToken_eq_excl(code: number): void {
    // '=!'
    var next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 61) {
      this.finishOp(types.equality, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
      return;
    }

    if (code === 61 && next === 62) {
      // '=>'
      this.state.pos += 2;
      this.finishToken(types.arrow);
      return;
    }

    this.finishOp(code === 61 ? types.eq : types.bang, 1);
  }

  readToken_question(): void {
    // '?'
    var next = this.input.charCodeAt(this.state.pos + 1);
    var next2 = this.input.charCodeAt(this.state.pos + 2);

    if (next === 63) {
      // '??'
      this.finishOp(types.nullishCoalescing, 2);
    } else if (next === 46 && !(next2 >= 48 && next2 <= 57)) {
      // '.' not followed by a number
      this.state.pos += 2;
      this.finishToken(types.questionDot);
    } else {
      ++this.state.pos;
      this.finishToken(types.question);
    }
  }

  getTokenFromCode(code: number): void {
    switch (code) {
      case 35:
        // '#'
        if ((this.hasPlugin("classPrivateProperties") || this.hasPlugin("classPrivateMethods")) && this.state.classLevel > 0) {
          ++this.state.pos;
          this.finishToken(types.hash);
          return;
        } else {
          this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
        }

      // The interpretation of a dot depends on whether it is followed
      // by a digit or another two dots.

      case 46:
        // '.'
        this.readToken_dot();
        return;
      // Punctuation tokens.

      case 40:
        ++this.state.pos;
        this.finishToken(types.parenL);
        return;

      case 41:
        ++this.state.pos;
        this.finishToken(types.parenR);
        return;

      case 59:
        ++this.state.pos;
        this.finishToken(types.semi);
        return;

      case 44:
        ++this.state.pos;
        this.finishToken(types.comma);
        return;

      case 91:
        ++this.state.pos;
        this.finishToken(types.bracketL);
        return;

      case 93:
        ++this.state.pos;
        this.finishToken(types.bracketR);
        return;

      case 123:
        if (this.hasPlugin("flow") && this.input.charCodeAt(this.state.pos + 1) === 124) {
          this.finishOp(types.braceBarL, 2);
        } else {
          ++this.state.pos;
          this.finishToken(types.braceL);
        }

        return;

      case 125:
        ++this.state.pos;
        this.finishToken(types.braceR);
        return;

      case 58:
        if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
          this.finishOp(types.doubleColon, 2);
        } else {
          ++this.state.pos;
          this.finishToken(types.colon);
        }

        return;

      case 63:
        this.readToken_question();
        return;

      case 64:
        ++this.state.pos;
        this.finishToken(types.at);
        return;

      case 96:
        // '`'
        ++this.state.pos;
        this.finishToken(types.backQuote);
        return;

      case 48:
        {
          // '0'
          var next = this.input.charCodeAt(this.state.pos + 1); // '0x', '0X' - hex number

          if (next === 120 || next === 88) {
            this.readRadixNumber(16);
            return;
          } // '0o', '0O' - octal number


          if (next === 111 || next === 79) {
            this.readRadixNumber(8);
            return;
          } // '0b', '0B' - binary number


          if (next === 98 || next === 66) {
            this.readRadixNumber(2);
            return;
          }
        }
      // Anything else beginning with a digit is an integer, octal
      // number, or float.

      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        // 1-9
        this.readNumber(false);
        return;
      // Quotes produce strings.

      case 34:
      case 39:
        // '"', "'"
        this.readString(code);
        return;
      // Operators are parsed inline in tiny state machines. '=' (61) is
      // often referred to. `finishOp` simply skips the amount of
      // characters it is given as second argument, and returns a token
      // of the type given by its first argument.

      case 47:
        // '/'
        this.readToken_slash();
        return;

      case 37:
      case 42:
        // '%*'
        this.readToken_mult_modulo(code);
        return;

      case 124:
      case 38:
        // '|&'
        this.readToken_pipe_amp(code);
        return;

      case 94:
        // '^'
        this.readToken_caret();
        return;

      case 43:
      case 45:
        // '+-'
        this.readToken_plus_min(code);
        return;

      case 60:
      case 62:
        // '<>'
        this.readToken_lt_gt(code);
        return;

      case 61:
      case 33:
        // '=!'
        this.readToken_eq_excl(code);
        return;

      case 126:
        // '~'
        this.finishOp(types.tilde, 1);
        return;
    }

    this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
  }

  finishOp(type: TokenType, size: number): void {
    var str = this.input.slice(this.state.pos, this.state.pos + size);
    this.state.pos += size;
    this.finishToken(type, str);
  }

  readRegexp(): void {
    var start = this.state.pos;
    var escaped, inClass;

    for (;;) {
      if (this.state.pos >= this.input.length) {
        this.raise(start, "Unterminated regular expression");
      }

      var ch = this.input.charAt(this.state.pos);

      if (lineBreak.test(ch)) {
        this.raise(start, "Unterminated regular expression");
      }

      if (escaped) {
        escaped = false;
      } else {
        if (ch === "[") {
          inClass = true;
        } else if (ch === "]" && inClass) {
          inClass = false;
        } else if (ch === "/" && !inClass) {
          break;
        }

        escaped = ch === "\\";
      }

      ++this.state.pos;
    }

    var content = this.input.slice(start, this.state.pos);
    ++this.state.pos; // Need to use `readWord1` because '\uXXXX' sequences are allowed
    // here (don't ask).

    var mods = this.readWord1();

    if (mods) {
      var validFlags = /^[gmsiyu]*$/;

      if (!validFlags.test(mods)) {
        this.raise(start, "Invalid regular expression flag");
      }
    }

    this.finishToken(types.regexp, {
      pattern: content,
      flags: mods
    });
  } // Read an integer in the given radix. Return null if zero digits
  // were read, the integer value otherwise. When `len` is given, this
  // will return `null` unless the integer has exactly `len` digits.


  readInt(radix: number, len?: number): number | null {
    var start = this.state.pos;
    var forbiddenSiblings = radix === 16 ? forbiddenNumericSeparatorSiblings.hex : forbiddenNumericSeparatorSiblings.decBinOct;
    var allowedSiblings = radix === 16 ? allowedNumericSeparatorSiblings.hex : radix === 10 ? allowedNumericSeparatorSiblings.dec : radix === 8 ? allowedNumericSeparatorSiblings.oct : allowedNumericSeparatorSiblings.bin;
    var total = 0;

    for (var i = 0, e = len == null ? Infinity : len; i < e; ++i) {
      var code = this.input.charCodeAt(this.state.pos);
      var val: number | undefined = void 0;

      if (this.hasPlugin("numericSeparator")) {
        var prev = this.input.charCodeAt(this.state.pos - 1);
        var next = this.input.charCodeAt(this.state.pos + 1);

        if (code === 95) {
          if (allowedSiblings.indexOf(next) === -1) {
            this.raise(this.state.pos, "Invalid or unexpected token");
          }

          if (forbiddenSiblings.indexOf(prev) > -1 || forbiddenSiblings.indexOf(next) > -1 || Number.isNaN(next)) {
            this.raise(this.state.pos, "Invalid or unexpected token");
          } // Ignore this _ character


          ++this.state.pos;
          continue;
        }
      }

      if (code >= 97) {
        val = code - 97 + 10; // a
      } else if (code >= 65) {
        val = code - 65 + 10; // A
      } else if (code >= 48 && code <= 57) {
        val = code - 48; // 0-9
      } else {
        val = Infinity;
      }

      if (val >= radix) break;
      ++this.state.pos;
      total = total * radix + val;
    }

    if (this.state.pos === start || len != null && this.state.pos - start !== len) {
      return null;
    }

    return total;
  }

  readRadixNumber(radix: number): void {
    var start = this.state.pos;
    var isBigInt = false;
    this.state.pos += 2; // 0x

    var val = this.readInt(radix);

    if (val == null) {
      this.raise(this.state.start + 2, "Expected number in radix " + radix);
    }

    if (this.hasPlugin("bigInt")) {
      if (this.input.charCodeAt(this.state.pos) === 0x6e) {
        // 'n'
        ++this.state.pos;
        isBigInt = true;
      }
    }

    if (isIdentifierStart(this.fullCharCodeAtPos())) {
      this.raise(this.state.pos, "Identifier directly after number");
    }

    if (isBigInt) {
      var str = this.input.slice(start, this.state.pos).replace(/[_n]/g, "");
      this.finishToken(types.bigint, str);
      return;
    }

    this.finishToken(types.num, val);
  } // Read an integer, octal integer, or floating-point number.


  readNumber(startsWithDot: boolean | undefined): void {
    var start = this.state.pos;
    var octal = this.input.charCodeAt(start) === 0x30; // '0'

    var isFloat = false;
    var isBigInt = false;

    if (!startsWithDot && this.readInt(10) === null) {
      this.raise(start, "Invalid number");
    }

    if (octal && this.state.pos == start + 1) octal = false; // number === 0

    var next = this.input.charCodeAt(this.state.pos);

    if (next === 0x2e && !octal) {
      // '.'
      ++this.state.pos;
      this.readInt(10);
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }

    if ((next === 0x45 || next === 0x65) && !octal) {
      // 'Ee'
      next = this.input.charCodeAt(++this.state.pos);
      if (next === 0x2b || next === 0x2d) ++this.state.pos; // '+-'

      if (this.readInt(10) === null) this.raise(start, "Invalid number");
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }

    if (this.hasPlugin("bigInt")) {
      if (next === 0x6e) {
        // 'n'
        // disallow floats and legacy octal syntax, new style octal ("0o") is handled in this.readRadixNumber
        if (isFloat || octal) this.raise(start, "Invalid BigIntLiteral");
        ++this.state.pos;
        isBigInt = true;
      }
    }

    if (isIdentifierStart(this.fullCharCodeAtPos())) {
      this.raise(this.state.pos, "Identifier directly after number");
    } // remove "_" for numeric literal separator, and "n" for BigInts


    var str = this.input.slice(start, this.state.pos).replace(/[_n]/g, "");

    if (isBigInt) {
      this.finishToken(types.bigint, str);
      return;
    }

    var val;

    if (isFloat) {
      val = parseFloat(str);
    } else if (!octal || str.length === 1) {
      val = parseInt(str, 10);
    } else if (this.state.strict) {
      this.raise(start, "Invalid number");
    } else if (/[89]/.test(str)) {
      val = parseInt(str, 10);
    } else {
      val = parseInt(str, 8);
    }

    this.finishToken(types.num, val);
  } // Read a string value, interpreting backslash-escapes.


  readCodePoint(throwOnInvalid?: boolean): number | null {
    var ch = this.input.charCodeAt(this.state.pos);
    var code;

    if (ch === 123) {
      // '{'
      var codePos = ++this.state.pos;
      code = this.readHexChar(this.input.indexOf("}", this.state.pos) - this.state.pos, throwOnInvalid);
      ++this.state.pos;

      if (code === null) {
        // $FlowFixMe (is this always non-null?)
        --this.state.invalidTemplateEscapePosition!; // to point to the '\'' instead of the 'u'
      } else if (code > 0x10ffff) {
        if (throwOnInvalid) {
          this.raise(codePos, "Code point out of bounds");
        } else {
          this.state.invalidTemplateEscapePosition = codePos - 2;
          return null;
        }
      }
    } else {
      code = this.readHexChar(4, throwOnInvalid);
    }

    return code;
  }

  readString(quote: number): void {
    var out = "",
        chunkStart = ++this.state.pos;

    for (;;) {
      if (this.state.pos >= this.input.length) {
        this.raise(this.state.start, "Unterminated string constant");
      }

      var ch = this.input.charCodeAt(this.state.pos);
      if (ch === quote) break;

      if (ch === 92) {
        // '\'
        out += this.input.slice(chunkStart, this.state.pos); // $FlowFixMe

        out += this.readEscapedChar(false);
        chunkStart = this.state.pos;
      } else {
        if (isNewLine(ch)) {
          this.raise(this.state.start, "Unterminated string constant");
        }

        ++this.state.pos;
      }
    }

    out += this.input.slice(chunkStart, this.state.pos++);
    this.finishToken(types.string, out);
  } // Reads template string tokens.


  readTmplToken(): void {
    var out = "",
        chunkStart = this.state.pos,
        containsInvalid = false;

    for (;;) {
      if (this.state.pos >= this.input.length) {
        this.raise(this.state.start, "Unterminated template");
      }

      var ch = this.input.charCodeAt(this.state.pos);

      if (ch === 96 || ch === 36 && this.input.charCodeAt(this.state.pos + 1) === 123) {
        // '`', '${'
        if (this.state.pos === this.state.start && this.match(types.template)) {
          if (ch === 36) {
            this.state.pos += 2;
            this.finishToken(types.dollarBraceL);
            return;
          } else {
            ++this.state.pos;
            this.finishToken(types.backQuote);
            return;
          }
        }

        out += this.input.slice(chunkStart, this.state.pos);
        this.finishToken(types.template, containsInvalid ? null : out);
        return;
      }

      if (ch === 92) {
        // '\'
        out += this.input.slice(chunkStart, this.state.pos);
        var escaped = this.readEscapedChar(true);

        if (escaped === null) {
          containsInvalid = true;
        } else {
          out += escaped;
        }

        chunkStart = this.state.pos;
      } else if (isNewLine(ch)) {
        out += this.input.slice(chunkStart, this.state.pos);
        ++this.state.pos;

        switch (ch) {
          case 13:
            if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos;

          case 10:
            out += "\n";
            break;

          default:
            out += String.fromCharCode(ch);
            break;
        }

        ++this.state.curLine;
        this.state.lineStart = this.state.pos;
        chunkStart = this.state.pos;
      } else {
        ++this.state.pos;
      }
    }
  } // Used to read escaped characters


  readEscapedChar(inTemplate: boolean | undefined): string | null {
    var throwOnInvalid = !inTemplate;
    var ch = this.input.charCodeAt(++this.state.pos);
    ++this.state.pos;

    switch (ch) {
      case 110:
        return "\n";
      // 'n' -> '\n'

      case 114:
        return "\r";
      // 'r' -> '\r'

      case 120:
        {
          // 'x'
          var code = this.readHexChar(2, throwOnInvalid);
          return code === null ? null : String.fromCharCode(code);
        }

      case 117:
        {
          // 'u'
          var _code = this.readCodePoint(throwOnInvalid);

          return _code === null ? null : codePointToString(_code);
        }

      case 116:
        return "\t";
      // 't' -> '\t'

      case 98:
        return "\b";
      // 'b' -> '\b'

      case 118:
        return "\u000b";
      // 'v' -> '\u000b'

      case 102:
        return "\f";
      // 'f' -> '\f'

      case 13:
        if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos;
      // '\r\n'

      case 10:
        // ' \n'
        this.state.lineStart = this.state.pos;
        ++this.state.curLine;
        return "";

      default:
        if (ch >= 48 && ch <= 55) {
          var codePos = this.state.pos - 1; // $FlowFixMe

          var octalStr = this.input.substr(this.state.pos - 1, 3).match(/^[0-7]+/)![0];
          var octal = parseInt(octalStr, 8);

          if (octal > 255) {
            octalStr = octalStr.slice(0, -1);
            octal = parseInt(octalStr, 8);
          }

          if (octal > 0) {
            if (inTemplate) {
              this.state.invalidTemplateEscapePosition = codePos;
              return null;
            } else if (this.state.strict) {
              this.raise(codePos, "Octal literal in strict mode");
            } else if (!this.state.containsOctal) {
              // These properties are only used to throw an error for an octal which occurs
              // in a directive which occurs prior to a "use strict" directive.
              this.state.containsOctal = true;
              this.state.octalPosition = codePos;
            }
          }

          this.state.pos += octalStr.length - 1;
          return String.fromCharCode(octal);
        }

        return String.fromCharCode(ch);
    }
  } // Used to read character escape sequences ('\x', '\u').


  readHexChar(len: number, throwOnInvalid?: boolean): number | null {
    var codePos = this.state.pos;
    var n = this.readInt(16, len);

    if (n === null) {
      if (throwOnInvalid) {
        this.raise(codePos, "Bad character escape sequence");
      } else {
        this.state.pos = codePos - 1;
        this.state.invalidTemplateEscapePosition = codePos - 1;
      }
    }

    return n;
  } // Read an identifier, and return it as a string. Sets `this.state.containsEsc`
  // to whether the word contained a '\u' escape.
  //
  // Incrementally adds only escaped chars, adding other chunks as-is
  // as a micro-optimization.


  readWord1(): string {
    this.state.containsEsc = false;
    var word = "",
        first = true,
        chunkStart = this.state.pos;

    while (this.state.pos < this.input.length) {
      var ch = this.fullCharCodeAtPos();

      if (isIdentifierChar(ch)) {
        this.state.pos += ch <= 0xffff ? 1 : 2;
      } else if (ch === 92) {
        // "\"
        this.state.containsEsc = true;
        word += this.input.slice(chunkStart, this.state.pos);
        var escStart = this.state.pos;

        if (this.input.charCodeAt(++this.state.pos) !== 117) {
          // "u"
          this.raise(this.state.pos, "Expecting Unicode escape sequence \\uXXXX");
        }

        ++this.state.pos;
        var esc = this.readCodePoint(true); // $FlowFixMe (thinks esc may be null, but throwOnInvalid is true)

        if (!(first ? isIdentifierStart : isIdentifierChar)(esc!, true)) {
          this.raise(escStart, "Invalid Unicode escape");
        } // $FlowFixMe


        word += codePointToString(esc!);
        chunkStart = this.state.pos;
      } else {
        break;
      }

      first = false;
    }

    return word + this.input.slice(chunkStart, this.state.pos);
  } // Read an identifier or keyword token. Will check for reserved
  // words when necessary.


  readWord(): void {
    var word = this.readWord1();
    var type = types.name;

    if (this.isKeyword(word)) {
      if (this.state.containsEsc) {
        this.raise(this.state.pos, `Escape sequence in keyword ${word}`);
      }

      type = keywords[word];
    }

    this.finishToken(type, word);
  }

  braceIsBlock(prevType: TokenType): boolean {
    if (prevType === types.colon) {
      var parent = this.curContext();

      if (parent === types$1.braceStatement || parent === types$1.braceExpression) {
        return !parent.isExpr;
      }
    }

    if (prevType === types._return) {
      return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
    }

    if (prevType === types._else || prevType === types.semi || prevType === types.eof || prevType === types.parenR) {
      return true;
    }

    if (prevType === types.braceL) {
      return this.curContext() === types$1.braceStatement;
    }

    if (prevType === types.relational) {
      // `class C<T> { ... }`
      return true;
    }

    return !this.state.exprAllowed;
  }

  updateContext(prevType: TokenType): void {
    var type = this.state.type;
    var update;

    if (type.keyword && (prevType === types.dot || prevType === types.questionDot)) {
      this.state.exprAllowed = false;
    } else if (update = type.updateContext) {
      update.call(this, prevType);
    } else {
      this.state.exprAllowed = type.beforeExpr;
    }
  }

  
}

class UtilParser extends Tokenizer {
  

  

  

  // TODO
  addExtra(node: Node, key: string, val: NodeValue): void {
    if (!node) return;
    var extra = node.extra = node.extra || {};
    extra[key] = val;
  } // TODO


  isRelational(op: string): boolean {
    return this.match(types.relational) && this.state.value === op;
  } // TODO


  expectRelational(op: string): void {
    if (this.isRelational(op)) {
      this.next();
    } else {
      this.unexpected(null, types.relational);
    }
  } // eat() for relational operators.


  eatRelational(op: string): boolean {
    if (this.isRelational(op)) {
      this.next();
      return true;
    }

    return false;
  } // Tests whether parsed token is a contextual keyword.


  isContextual(name: string): boolean {
    return this.match(types.name) && this.state.value === name;
  }

  isLookaheadContextual(name: string): boolean {
    var l = this.lookahead();
    return l.type === types.name && l.value === name;
  } // Consumes contextual keyword if possible.


  eatContextual(name: string): boolean | undefined {
    return this.state.value === name && this.eat(types.name);
  } // Asserts that following token is given contextual keyword.


  expectContextual(name: string, message?: string): void {
    if (!this.eatContextual(name)) this.unexpected(null, message);
  } // Test whether a semicolon can be inserted at the current position.


  canInsertSemicolon(): boolean {
    return this.match(types.eof) || this.match(types.braceR) || this.hasPrecedingLineBreak();
  }

  hasPrecedingLineBreak(): boolean {
    return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
  } // TODO


  isLineTerminator(): boolean | undefined {
    return this.eat(types.semi) || this.canInsertSemicolon();
  } // Consume a semicolon, or, failing that, see if we are allowed to
  // pretend that there is a semicolon at this position.


  semicolon(): void {
    if (!this.isLineTerminator()) this.unexpected(null, types.semi);
  } // Expect a token of a given type. If found, consume it, otherwise,
  // raise an unexpected token error at given pos.


  expect(type: TokenType, pos?: number | null): void {
    this.eat(type) || this.unexpected(pos, type);
  } // Raise an unexpected token error. Can take the expected token type
  // instead of a message string.


  unexpected(pos?: number | null, messageOrType?: string | TokenType): never {
    if (messageOrType === void 0) {
      messageOrType = "Unexpected token";
    }

    if (typeof messageOrType !== "string") {
      messageOrType = `Unexpected token, expected ${messageOrType.label}`;
    }

    throw this.raise(pos != null ? pos : this.state.start, messageOrType);
  }

  expectPlugin(name: string, pos?: number): boolean {
    if (!this.hasPlugin(name)) {
      throw this.raise(pos != null ? pos : this.state.start, `This experimental syntax requires enabling the parser plugin: '${name}'`, [name]);
    }

    return true;
  }

  expectOnePlugin(names: string[], pos?: number): void {
    var _this = this;

    if (!names.some(function (n) {
      return _this.hasPlugin(n);
    })) {
      throw this.raise(pos != null ? pos : this.state.start, `This experimental syntax requires enabling one of the following parser plugin(s): '${names.join(", ")}'`, names);
    }
  }

  
}

// Start an AST node, attaching a start offset.
var commentKeys = ["leadingComments", "trailingComments", "innerComments"];

class Node {
  [key: string]: unknown;
  declare default: Node | boolean | null;
  declare supertype: Node | null;
  declare impltype: Node | null;
  declare qualification: Node;
  declare openingFragment: Node;
  declare closingFragment: Node | null;
  declare typeName: Node;
  declare parameterName: Node;
  declare exprName: Node;
  declare constraint: Node;
  declare parameters: (Node | null)[];
  declare readonly: boolean;
  declare members: Node[];
  declare typeParameter: Node;
  declare elementTypes: Node[];
  declare literal: Node;
  declare objectType: Node;
  declare indexType: Node;
  declare initializer: Node;
  declare const: boolean;
  declare global: boolean;
  declare isExport: boolean;
  declare moduleReference: Node;
  declare declare: boolean;
  declare abstract: boolean;
  declare accessibility: string;
  declare parameter: Node;

  declare type: string;
  declare start: number;
  declare end: number;
  declare loc: SourceLocation;
  declare range: number[];
  declare body: Node | Node[];
  declare value: NodeValue;
  declare expression: Node | boolean | null;
  declare extra: NodeExtra | null;
  declare leadingComments: Comment[] | null;
  declare trailingComments: Comment[] | null;
  declare innerComments: Comment[] | null;
  declare comments: Comment[];
  declare tokens: (Token | Comment)[];
  declare name: string | Node | null;
  declare kind: string | undefined;
  declare operator: string;
  declare directive: string;
  declare sourceType: string;
  declare exportKind: string;
  declare importKind: string | null;
  declare raw: string;
  declare pattern: string;
  declare flags: string;
  declare regex: RegExpValue;
  declare computed: boolean | undefined;
  declare async: boolean | undefined;
  declare await: boolean | undefined;
  declare generator: boolean | undefined;
  declare delegate: boolean | undefined;
  declare prefix: boolean;
  declare method: boolean;
  declare optional: boolean;
  declare selfClosing: boolean | undefined;
  declare shorthand: boolean;
  declare static: boolean | undefined;
  declare _exprListItem: boolean;
  declare tail: boolean;
  declare arguments: (Node | null)[];
  declare attributes: Node[];
  declare cases: Node[];
  declare children: Node[];
  declare declarations: Node[];
  declare decorators: Node[];
  declare directives: Node[];
  declare elements: (Node | null)[];
  declare expressions: Node[];
  declare extends: Node[];
  declare guardedHandlers: Node[];
  declare implements: Node[];
  declare mixins: Node[];
  declare params: (Node | null)[];
  declare properties: Node[];
  declare quasis: Node[];
  declare specifiers: Node[];
  declare types: Node[];
  declare argument: Node | null;
  declare alternate: Node | null;
  declare block: Node;
  declare bound: Node | null;
  declare callee: Node;
  declare closingElement: Node | null;
  declare declaration: Node | null;
  declare discriminant: Node;
  declare elementType: Node;
  declare exported: Node;
  declare finalizer: Node | null;
  declare handler: Node | null;
  declare id: Node | null;
  declare imported: Node;
  declare init: Node | null;
  declare key: Node;
  declare label: Node | null;
  declare left: Node;
  declare local: Node;
  declare meta: Node;
  declare namespace: Node;
  declare object: Node | null;
  declare openingElement: Node;
  declare predicate: Node | null;
  declare program: Node;
  declare property: Node;
  declare quasi: Node;
  declare rest: Node | null;
  declare returnType: Node | null | undefined;
  declare right: Node;
  declare source: Node | null;
  declare superClass: Node | null;
  declare superTypeParameters: Node;
  declare tag: Node;
  declare test: Node | null;
  declare typeAnnotation: Node | null | undefined;
  declare typeParameters: Node | null | undefined;
  declare update: Node | null;
  declare variance: Node | null;
  declare consequent: Node | Node[];
  declare indexers: Node[];
  declare callProperties: Node[];
  declare param: Node;
  declare exact: boolean | undefined;

  constructor(parser?: BaseParser, pos?: number, loc?: Position) {
    this.type = "";
    this.start = pos!;
    this.end = 0;
    this.loc = new SourceLocation(loc);
    if (parser && parser.options.ranges) this.range = [pos!, 0];
    if (parser && parser.filename) this.loc.filename = parser.filename;
  }

  

  __clone(): Node {
    var _this = this;

    // $FlowIgnore
    var node2 = new Node();
    Object.keys(this).forEach(function (key) {
      // Do not clone comments that are already attached to the node
      if (commentKeys.indexOf(key) < 0) {
        // $FlowIgnore
        node2[key] = _this[key];
      }
    });
    return node2;
  }

  
}

class NodeUtils extends UtilParser {
  

  

  

  startNode(): Node {
    // $FlowIgnore
    return new Node(this, this.state.start, this.state.startLoc);
  }

  startNodeAt(pos: number, loc: Position | null | undefined): Node {
    // $FlowIgnore
    return new Node(this, pos, loc!);
  }
  /** Start a new node with a previous node's location. */


  startNodeAtNode(type: Node): Node {
    return this.startNodeAt(type.start, type.loc.start);
  } // Finish an AST node, adding `type` and `end` properties.


  finishNode(node: Node, type: string | undefined): Node {
    return this.finishNodeAt(node, type, this.state.lastTokEnd, this.state.lastTokEndLoc);
  } // Finish node at given position


  finishNodeAt(node: Node, type: string | undefined, pos: number, loc: Position | null | undefined): Node {
    node.type = type!;
    node.end = pos;
    node.loc.end = loc;
    if (this.options.ranges) node.range[1] = pos;
    this.processComment(node);
    return node;
  }
  /**
   * Reset the start location of node to the start location of locationNode
   */


  resetStartLocationFromNode(node: Node, locationNode: Node): void {
    node.start = locationNode.start;
    node.loc.start = locationNode.loc.start;
    if (this.options.ranges) node.range[0] = locationNode.range[0];
  }

  
}

class LValParser extends NodeUtils {
  

  

  

  // Forward-declaration: defined in expression.js
  // Forward-declaration: defined in statement.js
  // Convert existing expression atom to assignable pattern
  // if possible.
  toAssignable(node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null {
    if (node) {
      switch (node.type) {
        case "Identifier":
        case "ObjectPattern":
        case "ArrayPattern":
        case "AssignmentPattern":
          break;

        case "ObjectExpression":
          node.type = "ObjectPattern";

          for (var index = 0; index < node.properties.length; index++) {
            var prop = node.properties[index];
            var isLast = index === node.properties.length - 1;
            this.toAssignableObjectExpressionProp(prop, isBinding, isLast);
          }

          break;

        case "ObjectProperty":
          this.toAssignable(nodeValue(node.value), isBinding, contextDescription);
          break;

        case "SpreadElement":
          {
            this.checkToRestConversion(node);
            node.type = "RestElement";
            var arg = node.argument;
            this.toAssignable(arg, isBinding, contextDescription);
            break;
          }

        case "ArrayExpression":
          node.type = "ArrayPattern";
          this.toAssignableList(node.elements, isBinding, contextDescription);
          break;

        case "AssignmentExpression":
          if (node.operator === "=") {
            node.type = "AssignmentPattern";
            removeField(node, "operator");
          } else {
            this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
          }

          break;

        case "MemberExpression":
          if (!isBinding) break;

        default:
          {
            var message = "Invalid left-hand side" + (contextDescription ? " in " + contextDescription :
            /* istanbul ignore next */
            "expression");
            this.raise(node.start, message);
          }
      }
    }

    return node;
  }

  toAssignableObjectExpressionProp(prop: Node, isBinding?: boolean, isLast?: boolean): void {
    if (prop.type === "ObjectMethod") {
      var error = prop.kind === "get" || prop.kind === "set" ? "Object pattern can't contain getter or setter" : "Object pattern can't contain methods";
      this.raise(prop.key.start, error);
    } else if (prop.type === "SpreadElement" && !isLast) {
      this.raise(prop.start, "The rest element has to be the last element when destructuring");
    } else {
      this.toAssignable(prop, isBinding, "object destructuring pattern");
    }
  } // Convert list of expression atoms to binding list.


  toAssignableList(exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[] {
    var end = exprList.length;

    if (end) {
      var last = exprList[end - 1];

      if (last && last.type === "RestElement") {
        --end;
      } else if (last && last.type === "SpreadElement") {
        last.type = "RestElement";
        var arg = last.argument;
        this.toAssignable(arg, isBinding, contextDescription);

        if (arg!.type !== "Identifier" && arg!.type !== "MemberExpression" && arg!.type !== "ArrayPattern") {
          this.unexpected(arg!.start);
        }

        --end;
      }
    }

    for (var i = 0; i < end; i++) {
      var elt = exprList[i];

      if (elt && elt.type === "SpreadElement") {
        this.raise(elt.start, "The rest element has to be the last element when destructuring");
      }

      if (elt) this.toAssignable(elt, isBinding, contextDescription);
    }

    return exprList;
  } // Convert list of expression atoms to a list of


  toReferencedList(exprList: (Node | null)[]): (Node | null)[] {
    return exprList;
  } // Parses spread element.


  parseSpread(refShorthandDefaultPos: StartReference | undefined): Node {
    var node = this.startNode();
    this.next();
    node.argument = this.parseMaybeAssign(false, refShorthandDefaultPos);
    return this.finishNode(node, "SpreadElement");
  }

  parseRest(): Node {
    var node = this.startNode();
    this.next();
    node.argument = this.parseBindingAtom();
    return this.finishNode(node, "RestElement");
  }

  shouldAllowYieldIdentifier(): boolean {
    return this.match(types._yield) && !this.state.strict && !this.state.inGenerator;
  }

  parseBindingIdentifier(): Node {
    return this.parseIdentifier(this.shouldAllowYieldIdentifier());
  } // Parses lvalue (assignable) atom.


  parseBindingAtom(): Node {
    switch (this.state.type) {
      case types._yield:
      case types.name:
        return this.parseBindingIdentifier();

      case types.bracketL:
        {
          var node = this.startNode();
          this.next();
          node.elements = this.parseBindingList(types.bracketR, true);
          return this.finishNode(node, "ArrayPattern");
        }

      case types.braceL:
        return this.parseObj(true);

      default:
        throw this.unexpected();
    }
  }

  parseBindingList(close: TokenType, allowEmpty?: boolean, allowModifiers?: boolean): (Node | null)[] {
    var elts = [];
    var first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
      }

      if (allowEmpty && this.match(types.comma)) {
        // $FlowFixMe This method returns `$ReadOnlyArray<?Pattern>` if `allowEmpty` is set.
        elts.push(null);
      } else if (this.eat(close)) {
        break;
      } else if (this.match(types.ellipsis)) {
        elts.push(this.parseAssignableListItemTypes(this.parseRest()));
        this.expect(close);
        break;
      } else {
        var decorators = [];

        if (this.match(types.at) && this.hasPlugin("decorators2")) {
          this.raise(this.state.start, "Stage 2 decorators cannot be used to decorate parameters");
        }

        while (this.match(types.at)) {
          decorators.push(this.parseDecorator());
        }

        elts.push(this.parseAssignableListItem(allowModifiers, decorators));
      }
    }

    return elts;
  }

  parseAssignableListItem(allowModifiers?: boolean, decorators?: Node[]): Node {
    var left = this.parseMaybeDefault();
    this.parseAssignableListItemTypes(left);
    var elt = this.parseMaybeDefault(left.start, left.loc.start, left);

    if (decorators!.length) {
      left.decorators = decorators!;
    }

    return elt;
  }

  parseAssignableListItemTypes(param: Node): Node {
    return param;
  } // Parses assignment pattern around given atom if possible.


  parseMaybeDefault(startPos?: number, startLoc?: Position | null | undefined, left?: Node): Node {
    startLoc = startLoc || this.state.startLoc;
    startPos = startPos || this.state.start;
    left = left || this.parseBindingAtom();
    if (!this.eat(types.eq)) return left;
    var node = this.startNodeAt(startPos!, startLoc);
    node.left = left;
    node.right = this.parseMaybeAssign();
    return this.finishNode(node, "AssignmentPattern");
  } // Verify that a node is an lval — something that can be assigned
  // to.


  checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void {
    switch (expr.type) {
      case "Identifier":
        this.checkReservedWord(expr.name!, expr.start, false, true);

        if (checkClashes) {
          // we need to prefix this with an underscore for the cases where we have a key of
          // `__proto__`. there's a bug in old V8 where the following wouldn't work:
          //
          //   > var obj = Object.create(null);
          //   undefined
          //   > obj.__proto__
          //   null
          //   > obj.__proto__ = true;
          //   true
          //   > obj.__proto__
          //   null
          var _key = `_${expr.name}`;

          if (checkClashes[_key]) {
            this.raise(expr.start, "Argument name clash in strict mode");
          } else {
            checkClashes[_key] = true;
          }
        }

        break;

      case "MemberExpression":
        if (isBinding) this.raise(expr.start, "Binding member expression");
        break;

      case "ObjectPattern":
        for (var _i2 = 0, _expr$properties2 = expr.properties; _i2 < _expr$properties2.length; _i2++) {
          var prop = _expr$properties2[_i2];
          if (prop.type === "ObjectProperty") prop = nodeValue(prop.value);
          this.checkLVal(prop, isBinding, checkClashes, "object destructuring pattern");
        }

        break;

      case "ArrayPattern":
        for (var _i4 = 0, _expr$elements2 = expr.elements; _i4 < _expr$elements2.length; _i4++) {
          var elem = _expr$elements2[_i4];

          if (elem) {
            this.checkLVal(elem, isBinding, checkClashes, "array destructuring pattern");
          }
        }

        break;

      case "AssignmentPattern":
        this.checkLVal(expr.left, isBinding, checkClashes, "assignment pattern");
        break;

      case "RestElement":
        this.checkLVal(expr.argument!, isBinding, checkClashes, "rest element");
        break;

      default:
        {
          var message = (isBinding ?
          /* istanbul ignore next */
          "Binding invalid" : "Invalid") + " left-hand side" + (contextDescription ? " in " + contextDescription :
          /* istanbul ignore next */
          "expression");
          this.raise(expr.start, message);
        }
    }
  }

  checkToRestConversion(node: Node): void {
    var validArgumentTypes = ["Identifier", "MemberExpression"];

    if (validArgumentTypes.indexOf(node.argument!.type) !== -1) {
      return;
    }

    this.raise(node.argument!.start, "Invalid rest operator's argument");
  }

  
}

/* eslint max-len: 0 */
// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser
class ExpressionParser extends LValParser {
  

  

  

  // Forward-declaration: defined in statement.js
  // Check if property name clashes with already added.
  // Object/class getters and setters are not allowed to clash —
  // either with each other or with an init property — and in
  // strict mode, init properties are also not allowed to be repeated.
  checkPropClash(prop: Node, propHash: Record<string, boolean>): void {
    if (prop.computed || prop.kind) return;
    var key = prop.key; // It is either an Identifier or a String/NumericLiteral

    var name = key.type === "Identifier" ? key.name : String(key.value);

    if (name === "__proto__") {
      if (propHash.proto) {
        this.raise(key.start, "Redefinition of __proto__ property");
      }

      propHash.proto = true;
    }
  } // Convenience method to parse an Expression only


  getExpression(): Node {
    this.nextToken();
    var expr = this.parseExpression();

    if (!this.match(types.eof)) {
      this.unexpected();
    }

    expr.comments = this.state.comments;
    return expr;
  } // ### Expression parsing
  // These nest, from the most general expression type at the top to
  // 'atomic', nondivisible expression types at the bottom. Most of
  // the functions will simply let the function (s) below them parse,
  // and, *if* the syntactic construct they handle is present, wrap
  // the AST node that the inner parser gave them in another node.
  // Parse a full expression. The optional arguments are used to
  // forbid the `in` operator (in for loops initialization expressions)
  // and provide reference for storing '=' operator inside shorthand
  // property assignment in contexts where both object expression
  // and object pattern might appear (so it's possible to raise
  // delayed syntax error at correct position).


  parseExpression(noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    var expr = this.parseMaybeAssign(noIn, refShorthandDefaultPos);

    if (this.match(types.comma)) {
      var _node = this.startNodeAt(startPos!, startLoc);

      _node.expressions = [expr];

      while (this.eat(types.comma)) {
        _node.expressions.push(this.parseMaybeAssign(noIn, refShorthandDefaultPos));
      }

      this.toReferencedList(_node.expressions);
      return this.finishNode(_node, "SequenceExpression");
    }

    return expr;
  } // Parse an assignment expression. This includes applications of
  // operators like `+=`.


  parseMaybeAssign(noIn?: boolean, refShorthandDefaultPos?: StartReference, afterLeftParse?: (this: BaseParser, node: Node, startPos: number, startLoc: Position) => Node, refNeedsArrowPos?: StartReference): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;

    if (this.match(types._yield) && this.state.inGenerator) {
      var _left = this.parseYield();

      if (afterLeftParse) {
        _left = afterLeftParse.call(this, _left, startPos, startLoc);
      }

      return _left;
    }

    var failOnShorthandAssign;

    if (refShorthandDefaultPos) {
      failOnShorthandAssign = false;
    } else {
      refShorthandDefaultPos = {
        start: 0
      };
      failOnShorthandAssign = true;
    }

    if (this.match(types.parenL) || this.match(types.name) || this.match(types._yield)) {
      this.state.potentialArrowAt = this.state.start;
    }

    var left = this.parseMaybeConditional(noIn, refShorthandDefaultPos, refNeedsArrowPos);

    if (afterLeftParse) {
      left = afterLeftParse.call(this, left, startPos, startLoc);
    }

    if (this.state.type.isAssign) {
      var _node2 = this.startNodeAt(startPos!, startLoc);

      _node2.operator = stringValue(this.state.value);
      _node2.left = (this.match(types.eq) ? this.toAssignable(left, undefined, "assignment expression") : left)!;
      refShorthandDefaultPos.start = 0; // reset because shorthand default was used correctly

      this.checkLVal(left, undefined, undefined, "assignment expression");

      if (left.extra && left.extra.parenthesized) {
        var errorMsg;

        if (left.type === "ObjectPattern") {
          errorMsg = "`({a}) = 0` use `({a} = 0)`";
        } else if (left.type === "ArrayPattern") {
          errorMsg = "`([a]) = 0` use `([a] = 0)`";
        }

        if (errorMsg) {
          this.raise(left.start, `You're trying to assign to a parenthesized expression, eg. instead of ${errorMsg}`);
        }
      }

      this.next();
      _node2.right = this.parseMaybeAssign(noIn);
      return this.finishNode(_node2, "AssignmentExpression");
    } else if (failOnShorthandAssign && refShorthandDefaultPos.start) {
      this.unexpected(refShorthandDefaultPos.start);
    }

    return left;
  } // Parse a ternary conditional (`?:`) operator.


  parseMaybeConditional(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos: StartReference | undefined): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    var potentialArrowAt = this.state.potentialArrowAt;
    var expr = this.parseExprOps(noIn, refShorthandDefaultPos);

    if (expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt) {
      return expr;
    }

    if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;
    return this.parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos);
  }

  parseConditional(expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position, refNeedsArrowPos?: StartReference): Node {
    if (this.eat(types.question)) {
      var _node3 = this.startNodeAt(startPos!, startLoc);

      _node3.test = expr;
      _node3.consequent = this.parseMaybeAssign();
      this.expect(types.colon);
      _node3.alternate = this.parseMaybeAssign(noIn);
      return this.finishNode(_node3, "ConditionalExpression");
    }

    return expr;
  } // Start the precedence parser.


  parseExprOps(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    var potentialArrowAt = this.state.potentialArrowAt;
    var expr = this.parseMaybeUnary(refShorthandDefaultPos);

    if (expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt) {
      return expr;
    }

    if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
      return expr;
    }

    return this.parseExprOp(expr, startPos, startLoc, -1, noIn);
  } // Parse binary operators with the operator precedence parsing
  // algorithm. `left` is the left-hand side of the operator.
  // `minPrec` provides context that allows the function to stop and
  // defer further parser to one of its callers when it encounters an
  // operator that has a lower precedence than the set it is parsing.


  parseExprOp(left: Node, leftStartPos: number, leftStartLoc: Position, minPrec: number, noIn: boolean | undefined): Node {
    var prec = this.state.type.binop;

    if (prec != null && (!noIn || !this.match(types._in))) {
      if (prec > minPrec) {
        var _node4 = this.startNodeAt(leftStartPos, leftStartLoc);

        _node4.left = left;
        _node4.operator = stringValue(this.state.value);

        if (_node4.operator === "**" && left.type === "UnaryExpression" && left.extra && !left.extra.parenthesizedArgument && !left.extra.parenthesized) {
          this.raise(left.argument!.start, "Illegal expression. Wrap left hand side or entire exponentiation in parentheses.");
        }

        var op = this.state.type;
        this.next();
        var startPos = this.state.start;
        var startLoc = this.state.startLoc;

        if (_node4.operator === "|>") {
          this.expectPlugin("pipelineOperator"); // Support syntax such as 10 |> x => x + 1

          this.state.potentialArrowAt = startPos;
        }

        if (_node4.operator === "??") {
          this.expectPlugin("nullishCoalescingOperator");
        }

        _node4.right = this.parseExprOp(this.parseMaybeUnary(), startPos, startLoc, op.rightAssociative ? prec - 1 : prec, noIn);
        this.finishNode(_node4, op === types.logicalOR || op === types.logicalAND || op === types.nullishCoalescing ? "LogicalExpression" : "BinaryExpression");
        return this.parseExprOp(_node4, leftStartPos, leftStartLoc, minPrec, noIn);
      }
    }

    return left;
  } // Parse unary operators, both prefix and postfix.


  parseMaybeUnary(refShorthandDefaultPos?: StartReference | undefined): Node {
    if (this.state.type.prefix) {
      var _node5 = this.startNode();

      var update = this.match(types.incDec);
      _node5.operator = stringValue(this.state.value);
      _node5.prefix = true;

      if (_node5.operator === "throw") {
        this.expectPlugin("throwExpressions");
      }

      this.next();
      var argType = this.state.type;
      _node5.argument = this.parseMaybeUnary();
      this.addExtra(_node5, "parenthesizedArgument", argType === types.parenL && (!_node5.argument.extra || !_node5.argument.extra.parenthesized));

      if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
        this.unexpected(refShorthandDefaultPos.start);
      }

      if (update) {
        this.checkLVal(_node5.argument, undefined, undefined, "prefix operation");
      } else if (this.state.strict && _node5.operator === "delete") {
        var arg = _node5.argument;

        if (arg.type === "Identifier") {
          this.raise(_node5.start, "Deleting local variable in strict mode");
        } else if (arg.type === "MemberExpression" && arg.property.type === "PrivateName") {
          this.raise(_node5.start, "Deleting a private field is not allowed");
        }
      }

      return this.finishNode(_node5, update ? "UpdateExpression" : "UnaryExpression");
    }

    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    var expr = this.parseExprSubscripts(refShorthandDefaultPos);
    if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;

    while (this.state.type.postfix && !this.canInsertSemicolon()) {
      var _node6 = this.startNodeAt(startPos!, startLoc);

      _node6.operator = stringValue(this.state.value);
      _node6.prefix = false;
      _node6.argument = expr;
      this.checkLVal(expr, undefined, undefined, "postfix operation");
      this.next();
      expr = this.finishNode(_node6, "UpdateExpression");
    }

    return expr;
  } // Parse call, dot, and `[]`-subscript expressions.


  parseExprSubscripts(refShorthandDefaultPos?: StartReference | undefined): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    var potentialArrowAt = this.state.potentialArrowAt;
    var expr = this.parseExprAtom(refShorthandDefaultPos);

    if (expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt) {
      return expr;
    }

    if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
      return expr;
    }

    return this.parseSubscripts(expr, startPos, startLoc);
  }

  parseSubscripts(base: Node, startPos: number, startLoc: Position, noCalls?: boolean): Node {
    var state = {
      stop: false
    };

    do {
      base = this.parseSubscript(base, startPos, startLoc, noCalls, state);
    } while (!state.stop);

    return base;
  }
  /** @param state Set 'state.stop = true' to indicate that we should stop parsing subscripts. */


  parseSubscript(base: Node, startPos: number, startLoc: Position, noCalls: boolean | undefined, state: SubscriptState): Node {
    if (!noCalls && this.eat(types.doubleColon)) {
      var _node7 = this.startNodeAt(startPos!, startLoc);

      _node7.object = base;
      _node7.callee = this.parseNoCallExpr();
      state.stop = true;
      return this.parseSubscripts(this.finishNode(_node7, "BindExpression"), startPos, startLoc, noCalls);
    } else if (this.match(types.questionDot)) {
      this.expectPlugin("optionalChaining");

      if (noCalls && this.lookahead().type == types.parenL) {
        state.stop = true;
        return base;
      }

      this.next();

      var _node8 = this.startNodeAt(startPos!, startLoc);

      if (this.eat(types.bracketL)) {
        _node8.object = base;
        _node8.property = this.parseExpression();
        _node8.computed = true;
        _node8.optional = true;
        this.expect(types.bracketR);
        return this.finishNode(_node8, "MemberExpression");
      } else if (this.eat(types.parenL)) {
        var possibleAsync = this.atPossibleAsync(base);
        _node8.callee = base;
        _node8.arguments = this.parseCallExpressionArguments(types.parenR, possibleAsync);
        _node8.optional = true;
        return this.finishNode(_node8, "CallExpression");
      } else {
        _node8.object = base;
        _node8.property = this.parseIdentifier(true);
        _node8.computed = false;
        _node8.optional = true;
        return this.finishNode(_node8, "MemberExpression");
      }
    } else if (this.eat(types.dot)) {
      var _node9 = this.startNodeAt(startPos!, startLoc);

      _node9.object = base;
      _node9.property = this.parseMaybePrivateName();
      _node9.computed = false;
      return this.finishNode(_node9, "MemberExpression");
    } else if (this.eat(types.bracketL)) {
      var _node10 = this.startNodeAt(startPos!, startLoc);

      _node10.object = base;
      _node10.property = this.parseExpression();
      _node10.computed = true;
      this.expect(types.bracketR);
      return this.finishNode(_node10, "MemberExpression");
    } else if (!noCalls && this.match(types.parenL)) {
      var _possibleAsync = this.atPossibleAsync(base);

      this.next();

      var _node11 = this.startNodeAt(startPos!, startLoc);

      _node11.callee = base; // TODO: Clean up/merge this into `this.state` or a class like acorn's
      // `DestructuringErrors` alongside refShorthandDefaultPos and
      // refNeedsArrowPos.

      var refTrailingCommaPos = {
        start: -1
      };
      _node11.arguments = this.parseCallExpressionArguments(types.parenR, _possibleAsync, refTrailingCommaPos);
      this.finishCallExpression(_node11);

      if (_possibleAsync && this.shouldParseAsyncArrow()) {
        state.stop = true;

        if (refTrailingCommaPos.start > -1) {
          this.raise(refTrailingCommaPos.start, "A trailing comma is not permitted after the rest element");
        }

        return this.parseAsyncArrowFromCallExpression(this.startNodeAt(startPos, startLoc), _node11);
      } else {
        this.toReferencedList(_node11.arguments);
      }

      return _node11;
    } else if (this.match(types.backQuote)) {
      var _node12 = this.startNodeAt(startPos!, startLoc);

      _node12.tag = base;
      _node12.quasi = this.parseTemplate(true);
      return this.finishNode(_node12, "TaggedTemplateExpression");
    } else {
      state.stop = true;
      return base;
    }
  }

  atPossibleAsync(base: Node): boolean {
    return this.state.potentialArrowAt === base.start && base.type === "Identifier" && base.name === "async" && !this.canInsertSemicolon();
  }

  finishCallExpression(node: Node): Node {
    if (node.callee.type === "Import") {
      if (node.arguments.length !== 1) {
        this.raise(node.start, "import() requires exactly one argument");
      }

      var importArg = node.arguments[0];

      if (importArg && importArg.type === "SpreadElement") {
        this.raise(importArg.start, "... is not allowed in import()");
      }
    }

    return this.finishNode(node, "CallExpression");
  }

  parseCallExpressionArguments(close: TokenType, possibleAsyncArrow?: boolean, refTrailingCommaPos?: StartReference): (Node | null)[] {
    var elts = [];
    var innerParenStart;
    var first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(close)) break;
      } // we need to make sure that if this is an async arrow functions, that we don't allow inner parens inside the params


      if (this.match(types.parenL) && !innerParenStart) {
        innerParenStart = this.state.start;
      }

      elts.push(this.parseExprListItem(false, possibleAsyncArrow ? {
        start: 0
      } : undefined, possibleAsyncArrow ? {
        start: 0
      } : undefined, possibleAsyncArrow ? refTrailingCommaPos : undefined));
    } // we found an async arrow function so let's not allow any inner parens


    if (possibleAsyncArrow && innerParenStart && this.shouldParseAsyncArrow()) {
      this.unexpected();
    }

    return elts;
  }

  shouldParseAsyncArrow(): boolean {
    return this.match(types.arrow);
  }

  parseAsyncArrowFromCallExpression(node: Node, call: Node): Node {
    this.expect(types.arrow);
    return this.parseArrowExpression(node, call.arguments, true);
  } // Parse a no-call expression (like argument of `new` or `::` operators).


  parseNoCallExpr(): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    return this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
  } // Parse an atomic expression — either a single token that is an
  // expression, an expression started by a keyword like `function` or
  // `new`, or an expression wrapped in punctuation like `()`, `[]`,
  // or `{}`.


  parseExprAtom(refShorthandDefaultPos?: StartReference): Node {
    var canBeArrow = this.state.potentialArrowAt === this.state.start;
    var node;

    switch (this.state.type) {
      case types._super:
        if (!this.state.inMethod && !this.state.inClassProperty && !this.options.allowSuperOutsideMethod) {
          this.raise(this.state.start, "'super' outside of function or class");
        }

        node = this.startNode();
        this.next();

        if (!this.match(types.parenL) && !this.match(types.bracketL) && !this.match(types.dot)) {
          this.unexpected();
        }

        if (this.match(types.parenL) && this.state.inMethod !== "constructor" && !this.options.allowSuperOutsideMethod) {
          this.raise(node.start, "super() is only valid inside a class constructor. Make sure the method name is spelled exactly as 'constructor'.");
        }

        return this.finishNode(node, "Super");

      case types._import:
        if (this.lookahead().type === types.dot) {
          return this.parseImportMetaProperty();
        }

        this.expectPlugin("dynamicImport");
        node = this.startNode();
        this.next();

        if (!this.match(types.parenL)) {
          this.unexpected(null, types.parenL);
        }

        return this.finishNode(node, "Import");

      case types._this:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "ThisExpression");

      case types._yield:
        if (this.state.inGenerator) this.unexpected();

      case types.name:
        {
          node = this.startNode();
          var allowAwait = this.state.value === "await" && this.state.inAsync;
          var allowYield = this.shouldAllowYieldIdentifier();
          var id = this.parseIdentifier(allowAwait || allowYield);

          if (id.name === "await") {
            if (this.state.inAsync || this.inModule) {
              return this.parseAwait(node);
            }
          } else if (id.name === "async" && this.match(types._function) && !this.canInsertSemicolon()) {
            this.next();
            return this.parseFunction(node, false, false, true);
          } else if (canBeArrow && id.name === "async" && this.match(types.name)) {
            var params = [this.parseIdentifier()];
            this.expect(types.arrow); // let foo = bar => {};

            return this.parseArrowExpression(node, params, true);
          }

          if (canBeArrow && !this.canInsertSemicolon() && this.eat(types.arrow)) {
            return this.parseArrowExpression(node, [id]);
          }

          return id;
        }

      case types._do:
        {
          this.expectPlugin("doExpressions");

          var _node13 = this.startNode();

          this.next();
          var oldInFunction = this.state.inFunction;
          var oldLabels = this.state.labels;
          this.state.labels = [];
          this.state.inFunction = false;
          _node13.body = this.parseBlock(false);
          this.state.inFunction = oldInFunction;
          this.state.labels = oldLabels;
          return this.finishNode(_node13, "DoExpression");
        }

      case types.regexp:
        {
          var value = regexpValue(this.state.value);
          node = this.parseLiteral(value!.value, "RegExpLiteral");
          node.pattern = value!.pattern;
          node.flags = value!.flags;
          return node;
        }

      case types.num:
        return this.parseLiteral(this.state.value, "NumericLiteral");

      case types.bigint:
        return this.parseLiteral(this.state.value, "BigIntLiteral");

      case types.string:
        return this.parseLiteral(this.state.value, "StringLiteral");

      case types._null:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "NullLiteral");

      case types._true:
      case types._false:
        return this.parseBooleanLiteral();

      case types.parenL:
        return this.parseParenAndDistinguishExpression(canBeArrow);

      case types.bracketL:
        node = this.startNode();
        this.next();
        node.elements = this.parseExprList(types.bracketR, true, refShorthandDefaultPos);
        this.toReferencedList(node.elements);
        return this.finishNode(node, "ArrayExpression");

      case types.braceL:
        return this.parseObj(false, refShorthandDefaultPos);

      case types._function:
        return this.parseFunctionExpression();

      case types.at:
        this.parseDecorators();

      case types._class:
        node = this.startNode();
        this.takeDecorators(node);
        return this.parseClass(node, false);

      case types._new:
        return this.parseNew();

      case types.backQuote:
        return this.parseTemplate(false);

      case types.doubleColon:
        {
          node = this.startNode();
          this.next();
          node.object = null;
          var callee = node.callee = this.parseNoCallExpr();

          if (callee.type === "MemberExpression") {
            return this.finishNode(node, "BindExpression");
          } else {
            throw this.raise(callee.start, "Binding should be performed on object property.");
          }
        }

      default:
        throw this.unexpected();
    }
  }

  parseBooleanLiteral(): Node {
    var node = this.startNode();
    node.value = this.match(types._true);
    this.next();
    return this.finishNode(node, "BooleanLiteral");
  }

  parseMaybePrivateName(): Node {
    var isPrivate = this.match(types.hash);

    if (isPrivate) {
      this.expectOnePlugin(["classPrivateProperties", "classPrivateMethods"]);

      var _node14 = this.startNode();

      this.next();
      _node14.id = this.parseIdentifier(true);
      return this.finishNode(_node14, "PrivateName");
    } else {
      return this.parseIdentifier(true);
    }
  }

  parseFunctionExpression(): Node {
    var node = this.startNode();
    var meta = this.parseIdentifier(true);

    if (this.state.inGenerator && this.eat(types.dot)) {
      return this.parseMetaProperty(node, meta, "sent");
    }

    return this.parseFunction(node, false);
  }

  parseMetaProperty(node: Node, meta: Node, propertyName: string): Node {
    node.meta = meta;

    if (meta.name === "function" && propertyName === "sent") {
      if (this.isContextual(propertyName)) {
        this.expectPlugin("functionSent");
      } else if (!this.hasPlugin("functionSent")) {
        // They didn't actually say `function.sent`, just `function.`, so a simple error would be less confusing.
        this.unexpected();
      }
    }

    node.property = this.parseIdentifier(true);

    if (node.property.name !== propertyName) {
      this.raise(node.property.start, `The only valid meta property for ${meta.name} is ${meta.name}.${propertyName}`);
    }

    return this.finishNode(node, "MetaProperty");
  }

  parseImportMetaProperty(): Node {
    var node = this.startNode();
    var id = this.parseIdentifier(true);
    this.expect(types.dot);

    if (id.name === "import") {
      if (this.isContextual("meta")) {
        this.expectPlugin("importMeta");
      } else if (!this.hasPlugin("importMeta")) {
        this.raise(id.start, `Dynamic imports require a parameter: import('a.js').then`);
      }
    }

    if (!this.inModule) {
      this.raise(id.start, `import.meta may appear only with 'sourceType: "module"'`);
    }

    return this.parseMetaProperty(node, id, "meta");
  }

  parseLiteral(value: NodeValue, type: string, startPos?: number, startLoc?: Position): Node {
    startPos = startPos || this.state.start;
    startLoc = startLoc || this.state.startLoc;
    var node = this.startNodeAt(startPos!, startLoc);
    this.addExtra(node, "rawValue", value);
    this.addExtra(node, "raw", this.input.slice(startPos, this.state.end));
    node.value = value;
    this.next();
    return this.finishNode(node, type);
  }

  parseParenExpression(): Node {
    this.expect(types.parenL);
    var val = this.parseExpression();
    this.expect(types.parenR);
    return val;
  }

  parseParenAndDistinguishExpression(canBeArrow: boolean | undefined): Node {
    var startPos = this.state.start;
    var startLoc = this.state.startLoc;
    var val;
    this.expect(types.parenL);
    var oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
    var oldYield = this.state.yieldInPossibleArrowParameters;
    this.state.maybeInArrowParameters = true;
    this.state.yieldInPossibleArrowParameters = null;
    var innerStartPos = this.state.start;
    var innerStartLoc = this.state.startLoc;
    var exprList = [];
    var refShorthandDefaultPos = {
      start: 0
    };
    var refNeedsArrowPos = {
      start: 0
    };
    var first = true;
    var spreadStart;
    var optionalCommaStart;

    while (!this.match(types.parenR)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma, refNeedsArrowPos.start || null);

        if (this.match(types.parenR)) {
          optionalCommaStart = this.state.start;
          break;
        }
      }

      if (this.match(types.ellipsis)) {
        var spreadNodeStartPos = this.state.start;
        var spreadNodeStartLoc = this.state.startLoc;
        spreadStart = this.state.start;
        exprList.push(this.parseParenItem(this.parseRest(), spreadNodeStartPos, spreadNodeStartLoc));

        if (this.match(types.comma) && this.lookahead().type === types.parenR) {
          this.raise(this.state.start, "A trailing comma is not permitted after the rest element");
        }

        break;
      } else {
        exprList.push(this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos));
      }
    }

    var innerEndPos = this.state.start;
    var innerEndLoc = this.state.startLoc;
    this.expect(types.parenR);
    this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
    var arrowNode = this.startNodeAt(startPos!, startLoc);

    if (canBeArrow && this.shouldParseArrow() && (arrowNode = this.parseArrow(arrowNode)!)) {
      for (var _i2 = 0; _i2 < exprList.length; _i2++) {
        var param = exprList[_i2];

        if (param.extra && param.extra.parenthesized) {
          this.unexpected(param.extra.parenStart);
        }
      }

      this.parseArrowExpression(arrowNode, exprList);
      this.state.yieldInPossibleArrowParameters = oldYield;
      return arrowNode;
    }

    this.state.yieldInPossibleArrowParameters = oldYield;

    if (!exprList.length) {
      this.unexpected(this.state.lastTokStart);
    }

    if (optionalCommaStart) this.unexpected(optionalCommaStart);
    if (spreadStart) this.unexpected(spreadStart);

    if (refShorthandDefaultPos.start) {
      this.unexpected(refShorthandDefaultPos.start);
    }

    if (refNeedsArrowPos.start) this.unexpected(refNeedsArrowPos.start);

    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.toReferencedList(val.expressions);
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }

    this.addExtra(val, "parenthesized", true);
    this.addExtra(val, "parenStart", startPos);
    return val;
  }

  shouldParseArrow(): boolean {
    return !this.canInsertSemicolon();
  }

  parseArrow(node: Node): Node | undefined {
    if (this.eat(types.arrow)) {
      return node;
    }
  }

  parseParenItem(node: Node, startPos?: number, startLoc?: Position): Node {
    return node;
  } // New's precedence is slightly tricky. It must allow its argument to
  // be a `[]` or dot subscript expression, but not a call — at least,
  // not without wrapping it in parentheses. Thus, it uses the noCalls
  // argument to parseSubscripts to prevent it from consuming the
  // argument list.


  parseNew(): Node {
    var node = this.startNode();
    var meta = this.parseIdentifier(true);

    if (this.eat(types.dot)) {
      var metaProp = this.parseMetaProperty(node, meta, "target");

      if (!this.state.inFunction && !this.state.inClassProperty) {
        var error = "new.target can only be used in functions";

        if (this.hasPlugin("classProperties")) {
          error += " or class properties";
        }

        this.raise(metaProp.start, error);
      }

      return metaProp;
    }

    node.callee = this.parseNoCallExpr();
    if (this.eat(types.questionDot)) node.optional = true;
    this.parseNewArguments(node);
    return this.finishNode(node, "NewExpression");
  }

  parseNewArguments(node: Node): void {
    if (this.eat(types.parenL)) {
      var args = this.parseExprList(types.parenR);
      this.toReferencedList(args); // $FlowFixMe (parseExprList should be all non-null in this case)

      node.arguments = args;
    } else {
      node.arguments = [];
    }
  } // Parse template expression.


  parseTemplateElement(isTagged?: boolean): Node {
    var elem = this.startNode();

    if (this.state.value === null) {
      if (!isTagged) {
        // TODO: fix this
        this.raise(this.state.invalidTemplateEscapePosition || 0, "Invalid escape sequence in template");
      } else {
        this.state.invalidTemplateEscapePosition = null;
      }
    }

    elem.value = {
      raw: this.input.slice(this.state.start, this.state.end).replace(/\r\n?/g, "\n"),
      cooked: this.state.value
    };
    this.next();
    elem.tail = this.match(types.backQuote);
    return this.finishNode(elem, "TemplateElement");
  }

  parseTemplate(isTagged?: boolean): Node {
    var node = this.startNode();
    this.next();
    node.expressions = [];
    var curElt = this.parseTemplateElement(isTagged);
    node.quasis = [curElt];

    while (!curElt.tail) {
      this.expect(types.dollarBraceL);
      node.expressions.push(this.parseExpression());
      this.expect(types.braceR);
      node.quasis.push(curElt = this.parseTemplateElement(isTagged));
    }

    this.next();
    return this.finishNode(node, "TemplateLiteral");
  } // Parse an object literal or binding pattern.


  parseObj(isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node {
    var decorators = [];
    var propHash: Record<string, boolean> = Object.create(null);
    var first = true;
    var node = this.startNode();
    node.properties = [];
    this.next();
    var firstRestLocation = null;

    while (!this.eat(types.braceR)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(types.braceR)) break;
      }

      if (this.match(types.at)) {
        if (this.hasPlugin("decorators2")) {
          this.raise(this.state.start, "Stage 2 decorators disallow object literal property decorators");
        } else {
          // we needn't check if decorators (stage 0) plugin is enabled since it's checked by
          // the call to this.parseDecorator
          while (this.match(types.at)) {
            decorators.push(this.parseDecorator());
          }
        }
      }

      var prop = this.startNode(),
          isGenerator = false,
          _isAsync = false,
          startPos: number | undefined = void 0,
          startLoc: Position | undefined = void 0;

      if (decorators!.length) {
        prop.decorators = decorators!;
        decorators = [];
      }

      if (this.match(types.ellipsis)) {
        this.expectPlugin("objectRestSpread");
        prop = this.parseSpread(isPattern ? {
          start: 0
        } : undefined);

        if (isPattern) {
          this.toAssignable(prop, true, "object pattern");
        }

        node.properties.push(prop);

        if (isPattern) {
          var position = this.state.start;

          if (firstRestLocation !== null) {
            this.unexpected(firstRestLocation, "Cannot have multiple rest elements when destructuring");
          } else if (this.eat(types.braceR)) {
            break;
          } else if (this.match(types.comma) && this.lookahead().type === types.braceR) {
            this.unexpected(position, "A trailing comma is not permitted after the rest element");
          } else {
            firstRestLocation = position;
            continue;
          }
        } else {
          continue;
        }
      }

      prop.method = false;

      if (isPattern || refShorthandDefaultPos) {
        startPos = this.state.start;
        startLoc = this.state.startLoc;
      }

      if (!isPattern) {
        isGenerator = this.eat(types.star)!;
      }

      if (!isPattern && this.isContextual("async")) {
        if (isGenerator) this.unexpected();
        var asyncId = this.parseIdentifier();

        if (this.match(types.colon) || this.match(types.parenL) || this.match(types.braceR) || this.match(types.eq) || this.match(types.comma)) {
          prop.key = asyncId;
          prop.computed = false;
        } else {
          _isAsync = true;

          if (this.match(types.star)) {
            this.expectPlugin("asyncGenerators");
            this.next();
            isGenerator = true;
          }

          this.parsePropertyName(prop);
        }
      } else {
        this.parsePropertyName(prop);
      }

      this.parseObjPropValue(prop, startPos, startLoc, isGenerator, _isAsync, isPattern, refShorthandDefaultPos);
      this.checkPropClash(prop, propHash);

      if (prop.shorthand) {
        this.addExtra(prop, "shorthand", true);
      }

      node.properties.push(prop);
    }

    if (firstRestLocation !== null) {
      this.unexpected(firstRestLocation, "The rest element has to be the last element when destructuring");
    }

    if (decorators!.length) {
      this.raise(this.state.start, "You have trailing decorators with no property");
    }

    return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
  }

  isGetterOrSetterMethod(prop: Node, isPattern: boolean | undefined): boolean | string | undefined {
    return !isPattern && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && (this.match(types.string) || // get "string"() {}
    this.match(types.num) || // get 1() {}
    this.match(types.bracketL) || // get ["string"]() {}
    this.match(types.name) || // get foo() {}
    !!this.state.type.keyword) // get debugger() {}
    ;
  } // get methods aren't allowed to have any parameters
  // set methods must have exactly 1 parameter


  checkGetterSetterParamCount(method: Node): void {
    var paramCount = method.kind === "get" ? 0 : 1;

    if (method.params.length !== paramCount) {
      var start = method.start;

      if (method.kind === "get") {
        this.raise(start, "getter should have no params");
      } else {
        this.raise(start, "setter should have exactly one param");
      }
    }
  }

  parseObjectMethod(prop: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined): Node | undefined {
    if (isAsync || isGenerator || this.match(types.parenL)) {
      if (isPattern) this.unexpected();
      prop.kind = "method";
      prop.method = true;
      return this.parseMethod(prop, isGenerator, isAsync,
      /* isConstructor */
      false, "ObjectMethod");
    }

    if (this.isGetterOrSetterMethod(prop, isPattern)) {
      if (isGenerator || isAsync) this.unexpected();
      prop.kind = stringValue(prop.key.name);
      this.parsePropertyName(prop);
      this.parseMethod(prop,
      /* isGenerator */
      false,
      /* isAsync */
      false,
      /* isConstructor */
      false, "ObjectMethod");
      this.checkGetterSetterParamCount(prop);
      return prop;
    }
  }

  parseObjectProperty(prop: Node, startPos: number | undefined, startLoc: Position | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined {
    prop.shorthand = false;

    if (this.eat(types.colon)) {
      prop.value = isPattern ? this.parseMaybeDefault(this.state.start, this.state.startLoc) : this.parseMaybeAssign(false, refShorthandDefaultPos);
      return this.finishNode(prop, "ObjectProperty");
    }

    if (!prop.computed && prop.key.type === "Identifier") {
      this.checkReservedWord(prop.key.name!, prop.key.start, true, true);

      if (isPattern) {
        prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
      } else if (this.match(types.eq) && refShorthandDefaultPos) {
        if (!refShorthandDefaultPos.start) {
          refShorthandDefaultPos.start = this.state.start;
        }

        prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
      } else {
        prop.value = prop.key.__clone();
      }

      prop.shorthand = true;
      return this.finishNode(prop, "ObjectProperty");
    }
  }

  parseObjPropValue(prop: Node, startPos: number | undefined, startLoc: Position | undefined, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference): Node | void {
    var node = this.parseObjectMethod(prop, isGenerator, isAsync, isPattern) || this.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos);
    if (!node) this.unexpected(); // $FlowFixMe

    return node;
  }

  parsePropertyName(prop: Node): Node {
    if (this.eat(types.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types.bracketR);
    } else {
      var oldInPropertyName = this.state.inPropertyName;
      this.state.inPropertyName = true; // We check if it's valid for it to be a private name when we push it.

      prop.key = this.match(types.num) || this.match(types.string) ? this.parseExprAtom() : this.parseMaybePrivateName();

      if (prop.key.type !== "PrivateName") {
        // ClassPrivateProperty is never computed, so we don't assign in that case.
        prop.computed = false;
      }

      this.state.inPropertyName = oldInPropertyName;
    }

    return prop.key;
  } // Initialize empty function node.


  initFunction(node: Node, isAsync: boolean | undefined): void {
    node.id = null;
    node.generator = false;
    node.expression = false;
    node.async = !!isAsync;
  } // Parse object or class method.


  parseMethod(node: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean, type?: string): Node {
    var oldInFunc = this.state.inFunction;
    var oldInMethod = this.state.inMethod;
    var oldInGenerator = this.state.inGenerator;
    this.state.inFunction = true;
    this.state.inMethod = node.kind || true;
    this.state.inGenerator = isGenerator;
    this.initFunction(node, isAsync);
    node.generator = !!isGenerator;
    var allowModifiers = isConstructor; // For TypeScript parameter properties

    this.parseFunctionParams(node, allowModifiers);
    this.parseFunctionBodyAndFinish(node, type);
    this.state.inFunction = oldInFunc;
    this.state.inMethod = oldInMethod;
    this.state.inGenerator = oldInGenerator;
    return node;
  } // Parse arrow function expression with given parameters.


  parseArrowExpression(node: Node, params: (Node | null)[], isAsync?: boolean | undefined): Node {
    // if we got there, it's no more "yield in possible arrow parameters";
    // it's just "yield in arrow parameters"
    if (this.state.yieldInPossibleArrowParameters) {
      this.raise(this.state.yieldInPossibleArrowParameters.start, "yield is not allowed in the parameters of an arrow function" + " inside a generator");
    }

    var oldInFunc = this.state.inFunction;
    this.state.inFunction = true;
    this.initFunction(node, isAsync);
    this.setArrowFunctionParameters(node, params);
    var oldInGenerator = this.state.inGenerator;
    var oldMaybeInArrowParameters = this.state.maybeInArrowParameters;
    this.state.inGenerator = false;
    this.state.maybeInArrowParameters = false;
    this.parseFunctionBody(node, true);
    this.state.inGenerator = oldInGenerator;
    this.state.inFunction = oldInFunc;
    this.state.maybeInArrowParameters = oldMaybeInArrowParameters;
    return this.finishNode(node, "ArrowFunctionExpression");
  }

  setArrowFunctionParameters(node: Node, params: (Node | null)[]): void {
    node.params = this.toAssignableList(params, true, "arrow function parameters");
  }

  isStrictBody(node: Node, isExpression: boolean | Node | null | undefined): boolean {
    if (!isExpression && nodeValue(node.body).directives.length) {
      for (var _i4 = 0, _node$body$directives2 = nodeValue(node.body).directives; _i4 < _node$body$directives2.length; _i4++) {
        var directive = _node$body$directives2[_i4];

        if (nodeValue(directive.value).value === "use strict") {
          return true;
        }
      }
    }

    return false;
  }

  parseFunctionBodyAndFinish(node: Node, type: string | undefined, allowExpressionBody?: boolean): void {
    // $FlowIgnore (node is not bodiless if we get here)
    this.parseFunctionBody(node, allowExpressionBody);
    this.finishNode(node, type);
  } // Parse function body and check parameters.


  parseFunctionBody(node: Node, allowExpression?: boolean): void {
    var isExpression = allowExpression && !this.match(types.braceL);
    var oldInParameters = this.state.inParameters;
    var oldInAsync = this.state.inAsync;
    this.state.inParameters = false;
    this.state.inAsync = node.async;

    if (isExpression) {
      node.body = this.parseMaybeAssign();
      node.expression = true;
    } else {
      // Start a new scope with regard to labels and the `inGenerator`
      // flag (restore them to their old value afterwards).
      var oldInGen = this.state.inGenerator;
      var oldInFunc = this.state.inFunction;
      var oldLabels = this.state.labels;
      this.state.inGenerator = node.generator;
      this.state.inFunction = true;
      this.state.labels = [];
      node.body = this.parseBlock(true);
      node.expression = false;
      this.state.inFunction = oldInFunc;
      this.state.inGenerator = oldInGen;
      this.state.labels = oldLabels;
    }

    this.state.inAsync = oldInAsync;
    this.checkFunctionNameAndParams(node, allowExpression);
    this.state.inParameters = oldInParameters;
  }

  checkFunctionNameAndParams(node: Node, isArrowFunction?: boolean): void {
    // If this is a strict mode function, verify that argument names
    // are not repeated, and it does not try to bind the words `eval`
    // or `arguments`.
    var isStrict = this.isStrictBody(node, node.expression); // Also check for arrow functions

    var checkLVal = this.state.strict || isStrict || isArrowFunction;
    var oldStrict = this.state.strict;
    if (isStrict) this.state.strict = isStrict;

    if (node.id) {
      this.checkReservedWord(node.id, node.start, true, true);
    }

    if (checkLVal) {
      var nameHash: Record<string, boolean> = Object.create(null);

      if (node.id) {
        this.checkLVal(node.id, true, undefined, "function name");
      }

      for (var _i6 = 0, _node$params2 = node.params; _i6 < _node$params2.length; _i6++) {
        var param = _node$params2[_i6];

        if (isStrict && param!.type !== "Identifier") {
          this.raise(param!.start, "Non-simple parameter in strict mode");
        }

        this.checkLVal(param!, true, nameHash, "function parameter list");
      }
    }

    this.state.strict = oldStrict;
  } // Parses a comma-separated list of expressions, and returns them as
  // an array. `close` is the token type that ends the list, and
  // `allowEmpty` can be turned on to allow subsequent commas with
  // nothing in between them to be parsed as `null` (which is needed
  // for array literals).


  parseExprList(close: TokenType, allowEmpty?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): (Node | null)[] {
    var elts = [];
    var first = true;

    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(close)) break;
      }

      elts.push(this.parseExprListItem(allowEmpty, refShorthandDefaultPos));
    }

    return elts;
  }

  parseExprListItem(allowEmpty: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos?: StartReference | undefined, refTrailingCommaPos?: StartReference): Node | null {
    var elt;

    if (allowEmpty && this.match(types.comma)) {
      elt = null;
    } else if (this.match(types.ellipsis)) {
      elt = this.parseSpread(refShorthandDefaultPos);

      if (refTrailingCommaPos && this.match(types.comma)) {
        refTrailingCommaPos.start = this.state.start;
      }
    } else {
      elt = this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos);
    }

    return elt;
  } // Parse the next token as an identifier. If `liberal` is true (used
  // when parsing properties), it will also convert keywords into
  // identifiers.


  parseIdentifier(liberal?: boolean | undefined): Node {
    var node = this.startNode();
    var name = this.parseIdentifierName(node.start, liberal);
    node.name = name;
    node.loc.identifierName = name;
    return this.finishNode(node, "Identifier");
  }

  parseIdentifierName(pos: number, liberal?: boolean): string {
    if (!liberal) {
      this.checkReservedWord(stringValue(this.state.value), this.state.start, !!this.state.type.keyword, false);
    }

    var name;

    if (this.match(types.name)) {
      name = this.state.value;
    } else if (this.state.type.keyword) {
      name = this.state.type.keyword;
    } else {
      throw this.unexpected();
    }

    if (!liberal && name === "await" && this.state.inAsync) {
      this.raise(pos, "invalid use of await inside of an async function");
    }

    this.next();
    return stringValue(name);
  }

  checkReservedWord(word: string | Node, startLoc: number, checkKeywords?: boolean, isBinding?: boolean): void {
    if (this.state.strict && (reservedWords.strict(word) || isBinding && reservedWords.strictBind(word))) {
      this.raise(startLoc, word + " is a reserved word in strict mode");
    }

    if (this.state.inGenerator && word === "yield") {
      this.raise(startLoc, "yield is a reserved word inside generator functions");
    }

    if (this.isReservedWord(word) || checkKeywords && this.isKeyword(word)) {
      this.raise(startLoc, word + " is a reserved word");
    }
  } // Parses await expression inside async function.


  parseAwait(node: Node): Node {
    // istanbul ignore next: this condition is checked at the call site so won't be hit here
    if (!this.state.inAsync) {
      this.unexpected();
    }

    if (this.match(types.star)) {
      this.raise(node.start, "await* has been removed from the async functions proposal. Use Promise.all() instead.");
    }

    node.argument = this.parseMaybeUnary();
    return this.finishNode(node, "AwaitExpression");
  } // Parses yield expression inside generator.


  parseYield(): Node {
    var node = this.startNode();

    if (this.state.inParameters) {
      this.raise(node.start, "yield is not allowed in generator parameters");
    }

    if (this.state.maybeInArrowParameters && // We only set yieldInPossibleArrowParameters if we haven't already
    // found a possible invalid YieldExpression.
    !this.state.yieldInPossibleArrowParameters) {
      this.state.yieldInPossibleArrowParameters = node;
    }

    this.next();

    if (this.match(types.semi) || this.canInsertSemicolon() || !this.match(types.star) && !this.state.type.startsExpr) {
      node.delegate = false;
      node.argument = null;
    } else {
      node.delegate = this.eat(types.star);
      node.argument = this.parseMaybeAssign();
    }

    return this.finishNode(node, "YieldExpression");
  }

  
}

/* eslint max-len: 0 */
var empty: Node[] = [];
var loopLabel = {
  kind: "loop"
};
var switchLabel = {
  kind: "switch"
};

class StatementParser extends ExpressionParser {
  

  

  

  // ### Statement parsing
  // Parse a program. Initializes the parser, reads any number of
  // statements, and wraps them in a Program node.  Optionally takes a
  // `program` argument.  If present, the statements will be appended
  // to its body instead of creating a new node.
  parseTopLevel(file: Node, program: Node): Node {
    program.sourceType = this.options.sourceType;
    this.parseBlockBody(program, true, true, types.eof);
    file.program = this.finishNode(program, "Program");
    file.comments = this.state.comments;
    if (this.options.tokens) file.tokens = this.state.tokens;
    return this.finishNode(file, "File");
  } // TODO


  stmtToDirective(stmt: Node): Node {
    var expr = nodeValue(stmt.expression);
    var directiveLiteral = this.startNodeAt(expr.start, expr.loc.start);
    var directive = this.startNodeAt(stmt.start, stmt.loc.start);
    var raw = this.input.slice(expr.start, expr.end);
    var val = directiveLiteral.value = raw.slice(1, -1); // remove quotes

    this.addExtra(directiveLiteral, "raw", raw);
    this.addExtra(directiveLiteral, "rawValue", val);
    directive.value = this.finishNodeAt(directiveLiteral, "DirectiveLiteral", expr.end, expr.loc.end);
    return this.finishNodeAt(directive, "Directive", stmt.end, stmt.loc.end);
  } // Parse a single statement.
  //
  // If expecting a statement and finding a slash operator, parse a
  // regular expression literal. This is to handle cases like
  // `if (foo) /blah/.exec(foo)`, where looking at the previous token
  // does not help.


  parseStatement(declaration: boolean | undefined, topLevel?: boolean | undefined): Node {
    if (this.match(types.at)) {
      this.parseDecorators(true);
    }

    return this.parseStatementContent(declaration, topLevel);
  }

  parseStatementContent(declaration?: boolean, topLevel?: boolean): Node {
    var starttype = this.state.type;
    var node = this.startNode(); // Most types of statements are recognized by the keyword they
    // start with. Many are trivial to parse, some require a bit of
    // complexity.

    switch (starttype) {
      case types._break:
      case types._continue:
        // $FlowFixMe
        return this.parseBreakContinueStatement(node, starttype.keyword);

      case types._debugger:
        return this.parseDebuggerStatement(node);

      case types._do:
        return this.parseDoStatement(node);

      case types._for:
        return this.parseForStatement(node);

      case types._function:
        if (this.lookahead().type === types.dot) break;
        if (!declaration) this.unexpected();
        return this.parseFunctionStatement(node);

      case types._class:
        if (!declaration) this.unexpected();
        return this.parseClass(node, true);

      case types._if:
        return this.parseIfStatement(node);

      case types._return:
        return this.parseReturnStatement(node);

      case types._switch:
        return this.parseSwitchStatement(node);

      case types._throw:
        return this.parseThrowStatement(node);

      case types._try:
        return this.parseTryStatement(node);

      case types._let:
      case types._const:
        if (!declaration) this.unexpected();
      // NOTE: falls through to _var

      case types._var:
        return this.parseVarStatement(node, starttype);

      case types._while:
        return this.parseWhileStatement(node);

      case types._with:
        return this.parseWithStatement(node);

      case types.braceL:
        return this.parseBlock();

      case types.semi:
        return this.parseEmptyStatement(node);

      case types._export:
      case types._import:
        {
          if (this.hasPlugin("dynamicImport") && this.lookahead().type === types.parenL || this.hasPlugin("importMeta") && this.lookahead().type === types.dot) {
            break;
          }

          if (!this.options.allowImportExportEverywhere && !topLevel) {
            this.raise(this.state.start, "'import' and 'export' may only appear at the top level");
          }

          this.next();
          var result;

          if (starttype == types._import) {
            result = this.parseImport(node);
          } else {
            result = this.parseExport(node);
          }

          this.assertModuleNodeAllowed(node);
          return result;
        }

      case types.name:
        if (this.state.value === "async") {
          // peek ahead and see if next token is a function
          var state = this.state.clone();
          this.next();

          if (this.match(types._function) && !this.canInsertSemicolon()) {
            this.expect(types._function);
            return this.parseFunction(node, true, false, true);
          } else {
            this.state = state;
          }
        }

    } // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.


    var maybeName = this.state.value;
    var expr = this.parseExpression();

    if (starttype === types.name && expr.type === "Identifier" && this.eat(types.colon)) {
      return this.parseLabeledStatement(node, stringValue(maybeName), expr);
    } else {
      return this.parseExpressionStatement(node, expr);
    }
  }

  assertModuleNodeAllowed(node: Node): void {
    if (!this.options.allowImportExportEverywhere && !this.inModule) {
      this.raise(node.start, `'import' and 'export' may appear only with 'sourceType: "module"'`);
    }
  }

  takeDecorators(node: Node): void {
    var decorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];

    if (decorators!.length) {
      node.decorators = decorators!;
      this.resetStartLocationFromNode(node, decorators[0]);
      this.state.decoratorStack[this.state.decoratorStack.length - 1] = [];
    }
  }

  parseDecorators(allowExport?: boolean | undefined): void {
    if (this.hasPlugin("decorators2")) {
      allowExport = false;
    }

    var currentContextDecorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];

    while (this.match(types.at)) {
      var decorator = this.parseDecorator();
      currentContextDecorators.push(decorator);
    }

    if (this.match(types._export)) {
      if (allowExport) {
        return;
      } else {
        this.raise(this.state.start, "Using the export keyword between a decorator and a class is not allowed. Please use `export @dec class` instead");
      }
    }

    if (!this.match(types._class)) {
      this.raise(this.state.start, "Leading decorators must be attached to a class declaration");
    }
  }

  parseDecorator(): Node {
    this.expectOnePlugin(["decorators", "decorators2"]);
    var node = this.startNode();
    this.next();

    if (this.hasPlugin("decorators2")) {
      var startPos = this.state.start;
      var startLoc = this.state.startLoc;
      var expr = this.parseIdentifier(false);

      while (this.eat(types.dot)) {
        var _node = this.startNodeAt(startPos!, startLoc);

        _node.object = expr;
        _node.property = this.parseIdentifier(true);
        _node.computed = false;
        expr = this.finishNode(_node, "MemberExpression");
      }

      if (this.eat(types.parenL)) {
        var _node2 = this.startNodeAt(startPos!, startLoc);

        _node2.callee = expr; // Every time a decorator class expression is evaluated, a new empty array is pushed onto the stack
        // So that the decorators of any nested class expressions will be dealt with separately

        this.state.decoratorStack.push([]);
        _node2.arguments = this.parseCallExpressionArguments(types.parenR, false);
        this.state.decoratorStack.pop();
        expr = this.finishNode(_node2, "CallExpression");
        this.toReferencedList(expr.arguments);
      }

      node.expression = expr;
    } else {
      node.expression = this.parseMaybeAssign();
    }

    return this.finishNode(node, "Decorator");
  }

  parseBreakContinueStatement(node: Node, keyword: string | undefined): Node {
    var isBreak = keyword === "break";
    this.next();

    if (this.isLineTerminator()) {
      node.label = null;
    } else if (!this.match(types.name)) {
      this.unexpected();
    } else {
      node.label = this.parseIdentifier();
      this.semicolon();
    } // Verify that there is an actual destination to break or
    // continue to.


    var i;

    for (i = 0; i < this.state.labels.length; ++i) {
      var lab = this.state.labels[i];

      if (node.label == null || lab.name === node.label.name) {
        if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
        if (node.label && isBreak) break;
      }
    }

    if (i === this.state.labels.length) {
      this.raise(node.start, "Unsyntactic " + keyword);
    }

    return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
  }

  parseDebuggerStatement(node: Node): Node {
    this.next();
    this.semicolon();
    return this.finishNode(node, "DebuggerStatement");
  }

  parseDoStatement(node: Node): Node {
    this.next();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    this.expect(types._while);
    node.test = this.parseParenExpression();
    this.eat(types.semi);
    return this.finishNode(node, "DoWhileStatement");
  } // Disambiguating between a `for` and a `for`/`in` or `for`/`of`
  // loop is non-trivial. Basically, we have to parse the init `var`
  // statement or expression, disallowing the `in` operator (see
  // the second parameter to `parseExpression`), and then check
  // whether the next token is `in` or `of`. When there is no init
  // part (semicolon immediately after the opening parenthesis), it
  // is a regular `for` loop.


  parseForStatement(node: Node): Node {
    this.next();
    this.state.labels.push(loopLabel);
    var forAwait = false;

    if (this.state.inAsync && this.isContextual("await")) {
      this.expectPlugin("asyncGenerators");
      forAwait = true;
      this.next();
    }

    this.expect(types.parenL);

    if (this.match(types.semi)) {
      if (forAwait) {
        this.unexpected();
      }

      return this.parseFor(node, null);
    }

    if (this.match(types._var) || this.match(types._let) || this.match(types._const)) {
      var _init = this.startNode();

      var varKind = this.state.type;
      this.next();
      this.parseVar(_init, true, varKind);
      this.finishNode(_init, "VariableDeclaration");

      if (this.match(types._in) || this.isContextual("of")) {
        if (_init.declarations.length === 1 && !_init.declarations[0].init) {
          return this.parseForIn(node, _init, forAwait);
        }
      }

      if (forAwait) {
        this.unexpected();
      }

      return this.parseFor(node, _init);
    }

    var refShorthandDefaultPos = {
      start: 0
    };
    var init = this.parseExpression(true, refShorthandDefaultPos);

    if (this.match(types._in) || this.isContextual("of")) {
      var description = this.isContextual("of") ? "for-of statement" : "for-in statement";
      this.toAssignable(init, undefined, description);
      this.checkLVal(init, undefined, undefined, description);
      return this.parseForIn(node, init, forAwait);
    } else if (refShorthandDefaultPos.start) {
      this.unexpected(refShorthandDefaultPos.start);
    }

    if (forAwait) {
      this.unexpected();
    }

    return this.parseFor(node, init);
  }

  parseFunctionStatement(node: Node): Node {
    this.next();
    return this.parseFunction(node, true);
  }

  parseIfStatement(node: Node): Node {
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement(false);
    node.alternate = this.eat(types._else) ? this.parseStatement(false) : null;
    return this.finishNode(node, "IfStatement");
  }

  parseReturnStatement(node: Node): Node {
    if (!this.state.inFunction && !this.options.allowReturnOutsideFunction) {
      this.raise(this.state.start, "'return' outside of function");
    }

    this.next(); // In `return` (and `break`/`continue`), the keywords with
    // optional arguments, we eagerly look for a semicolon or the
    // possibility to insert one.

    if (this.isLineTerminator()) {
      node.argument = null;
    } else {
      node.argument = this.parseExpression();
      this.semicolon();
    }

    return this.finishNode(node, "ReturnStatement");
  }

  parseSwitchStatement(node: Node): Node {
    this.next();
    node.discriminant = this.parseParenExpression();
    var cases: Node[] = node.cases = [];
    this.expect(types.braceL);
    this.state.labels.push(switchLabel); // Statements under must be grouped (by label) in SwitchCase
    // nodes. `cur` is used to keep the node that we are currently
    // adding statements to.

    var cur;

    for (var sawDefault; !this.match(types.braceR);) {
      if (this.match(types._case) || this.match(types._default)) {
        var isCase = this.match(types._case);
        if (cur) this.finishNode(cur, "SwitchCase");
        cases.push(cur = this.startNode());
        cur.consequent = [];
        this.next();

        if (isCase) {
          cur.test = this.parseExpression();
        } else {
          if (sawDefault) {
            this.raise(this.state.lastTokStart, "Multiple default clauses");
          }

          sawDefault = true;
          cur.test = null;
        }

        this.expect(types.colon);
      } else {
        if (cur) {
          nodeArray(cur.consequent).push(this.parseStatement(true));
        } else {
          this.unexpected();
        }
      }
    }

    if (cur) this.finishNode(cur, "SwitchCase");
    this.next(); // Closing brace

    this.state.labels.pop();
    return this.finishNode(node, "SwitchStatement");
  }

  parseThrowStatement(node: Node): Node {
    this.next();

    if (lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start))) {
      this.raise(this.state.lastTokEnd, "Illegal newline after throw");
    }

    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, "ThrowStatement");
  }

  parseTryStatement(node: Node): Node {
    this.next();
    node.block = this.parseBlock();
    node.handler = null;

    if (this.match(types._catch)) {
      var clause = this.startNode();
      this.next();

      if (this.match(types.parenL)) {
        this.expect(types.parenL);
        clause.param = this.parseBindingAtom();
        var clashes: Record<string, boolean> = Object.create(null);
        this.checkLVal(clause.param, true, clashes, "catch clause");
        this.expect(types.parenR);
      } else {
        this.expectPlugin("optionalCatchBinding");
        clause.param = null!;
      }

      clause.body = this.parseBlock();
      node.handler = this.finishNode(clause, "CatchClause");
    }

    node.guardedHandlers = empty;
    node.finalizer = this.eat(types._finally) ? this.parseBlock() : null;

    if (!node.handler && !node.finalizer) {
      this.raise(node.start, "Missing catch or finally clause");
    }

    return this.finishNode(node, "TryStatement");
  }

  parseVarStatement(node: Node, kind: TokenType): Node {
    this.next();
    this.parseVar(node, false, kind);
    this.semicolon();
    return this.finishNode(node, "VariableDeclaration");
  }

  parseWhileStatement(node: Node): Node {
    this.next();
    node.test = this.parseParenExpression();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, "WhileStatement");
  }

  parseWithStatement(node: Node): Node {
    if (this.state.strict) {
      this.raise(this.state.start, "'with' in strict mode");
    }

    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement(false);
    return this.finishNode(node, "WithStatement");
  }

  parseEmptyStatement(node: Node): Node {
    this.next();
    return this.finishNode(node, "EmptyStatement");
  }

  parseLabeledStatement(node: Node, maybeName: string, expr: Node): Node {
    for (var _i2 = 0, _state$labels2 = this.state.labels; _i2 < _state$labels2.length; _i2++) {
      var label = _state$labels2[_i2];

      if (label.name === maybeName) {
        this.raise(expr.start, `Label '${maybeName}' is already declared`);
      }
    }

    var kind = this.state.type.isLoop ? "loop" : this.match(types._switch) ? "switch" : null;

    for (var i = this.state.labels.length - 1; i >= 0; i--) {
      var _label = this.state.labels[i];

      if (_label.statementStart === node.start) {
        _label.statementStart = this.state.start;
        _label.kind = kind;
      } else {
        break;
      }
    }

    this.state.labels.push({
      name: maybeName,
      kind: kind,
      statementStart: this.state.start
    });
    node.body = this.parseStatement(true);

    if (node.body.type == "ClassDeclaration" || node.body.type == "VariableDeclaration" && node.body.kind !== "var" || node.body.type == "FunctionDeclaration" && (this.state.strict || node.body.generator || node.body.async)) {
      this.raise(node.body.start, "Invalid labeled declaration");
    }

    this.state.labels.pop();
    node.label = expr;
    return this.finishNode(node, "LabeledStatement");
  }

  parseExpressionStatement(node: Node, expr: Node): Node {
    node.expression = expr;
    this.semicolon();
    return this.finishNode(node, "ExpressionStatement");
  } // Parse a semicolon-enclosed block of statements, handling `"use
  // strict"` declarations when `allowStrict` is true (used for
  // function bodies).


  parseBlock(allowDirectives?: boolean | undefined): Node {
    var node = this.startNode();
    this.expect(types.braceL);
    this.parseBlockBody(node, allowDirectives, false, types.braceR);
    return this.finishNode(node, "BlockStatement");
  }

  isValidDirective(stmt: Node): boolean {
    return stmt.type === "ExpressionStatement" && nodeValue(stmt.expression).type === "StringLiteral" && !nodeValue(stmt.expression).extra!.parenthesized;
  }

  parseBlockBody(node: Node, allowDirectives: boolean | undefined, topLevel: boolean | undefined, end: TokenType): void {
    var body: Node[] = node.body = [];
    var directives = node.directives = [];
    this.parseBlockOrModuleBlockBody(body, allowDirectives ? directives : undefined, topLevel, end);
  } // Undefined directives means that directives are not allowed.


  parseBlockOrModuleBlockBody(body: Node[], directives: Node[] | undefined, topLevel: boolean | undefined, end: TokenType): void {
    var parsedNonDirective = false;
    var oldStrict;
    var octalPosition;

    while (!this.eat(end)) {
      if (!parsedNonDirective && this.state.containsOctal && !octalPosition) {
        octalPosition = this.state.octalPosition;
      }

      var stmt = this.parseStatement(true, topLevel);

      if (directives && !parsedNonDirective && this.isValidDirective(stmt)) {
        var directive = this.stmtToDirective(stmt);
        directives.push(directive);

        if (oldStrict === undefined && nodeValue(directive.value).value === "use strict") {
          oldStrict = this.state.strict;
          this.setStrict(true);

          if (octalPosition) {
            this.raise(octalPosition, "Octal literal in strict mode");
          }
        }

        continue;
      }

      parsedNonDirective = true;
      body.push(stmt);
    }

    if (oldStrict === false) {
      this.setStrict(false);
    }
  } // Parse a regular `for` loop. The disambiguation code in
  // `parseStatement` will already have parsed the init statement or
  // expression.


  parseFor(node: Node, init: Node | null): Node {
    node.init = init;
    this.expect(types.semi);
    node.test = this.match(types.semi) ? null : this.parseExpression();
    this.expect(types.semi);
    node.update = this.match(types.parenR) ? null : this.parseExpression();
    this.expect(types.parenR);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, "ForStatement");
  } // Parse a `for`/`in` and `for`/`of` loop, which are almost
  // same from parser's perspective.


  parseForIn(node: Node, init: Node, forAwait: boolean | undefined): Node {
    var type = this.match(types._in) ? "ForInStatement" : "ForOfStatement";

    if (forAwait) {
      this.eatContextual("of");
    } else {
      this.next();
    }

    if (type === "ForOfStatement") {
      node.await = !!forAwait;
    }

    node.left = init;
    node.right = this.parseExpression();
    this.expect(types.parenR);
    node.body = this.parseStatement(false);
    this.state.labels.pop();
    return this.finishNode(node, type);
  } // Parse a list of variable declarations.


  parseVar(node: Node, isFor: boolean | undefined, kind: TokenType): Node {
    var declarations: Node[] = node.declarations = []; // $FlowFixMe

    node.kind = kind.keyword;

    for (;;) {
      var decl = this.startNode();
      this.parseVarHead(decl);

      if (this.eat(types.eq)) {
        decl.init = this.parseMaybeAssign(isFor);
      } else {
        if (kind === types._const && !(this.match(types._in) || this.isContextual("of"))) {
          // `const` with no initializer is allowed in TypeScript. It could be a declaration `const x: number;`.
          if (!this.hasPlugin("typescript")) {
            this.unexpected();
          }
        } else if (decl.id!.type !== "Identifier" && !(isFor && (this.match(types._in) || this.isContextual("of")))) {
          this.raise(this.state.lastTokEnd, "Complex binding patterns require an initialization value");
        }

        decl.init = null;
      }

      declarations.push(this.finishNode(decl, "VariableDeclarator"));
      if (!this.eat(types.comma)) break;
    }

    return node;
  }

  parseVarHead(decl: Node): void {
    decl.id = this.parseBindingAtom();
    this.checkLVal(decl.id, true, undefined, "variable declaration");
  } // Parse a function declaration or literal (depending on the
  // `isStatement` parameter).


  parseFunction(node: Node, isStatement: boolean | number, allowExpressionBody?: boolean | undefined, isAsync?: boolean | undefined, optionalId?: boolean | undefined): Node {
    var oldInFunc = this.state.inFunction;
    var oldInMethod = this.state.inMethod;
    var oldInGenerator = this.state.inGenerator;
    this.state.inFunction = true;
    this.state.inMethod = false;
    this.initFunction(node, isAsync);

    if (this.match(types.star)) {
      if (node.async) {
        this.expectPlugin("asyncGenerators");
      }

      node.generator = true;
      this.next();
    }

    if (isStatement && !optionalId && !this.match(types.name) && !this.match(types._yield)) {
      this.unexpected();
    } // When parsing function expression, the binding identifier is parsed
    // according to the rules inside the function.
    // e.g. (function* yield() {}) is invalid because "yield" is disallowed in
    // generators.
    // This isn't the case with function declarations: function* yield() {} is
    // valid because yield is parsed as if it was outside the generator.
    // Therefore, this.state.inGenerator is set before or after parsing the
    // function id according to the "isStatement" parameter.


    if (!isStatement) this.state.inGenerator = node.generator;

    if (this.match(types.name) || this.match(types._yield)) {
      node.id = this.parseBindingIdentifier();
    }

    if (isStatement) this.state.inGenerator = node.generator;
    this.parseFunctionParams(node);
    this.parseFunctionBodyAndFinish(node, isStatement ? "FunctionDeclaration" : "FunctionExpression", allowExpressionBody);
    this.state.inFunction = oldInFunc;
    this.state.inMethod = oldInMethod;
    this.state.inGenerator = oldInGenerator;
    return node;
  }

  parseFunctionParams(node: Node, allowModifiers?: boolean): void {
    var oldInParameters = this.state.inParameters;
    this.state.inParameters = true;
    this.expect(types.parenL);
    node.params = this.parseBindingList(types.parenR,
    /* allowEmpty */
    false, allowModifiers);
    this.state.inParameters = oldInParameters;
  } // Parse a class declaration or literal (depending on the
  // `isStatement` parameter).


  parseClass(node: Node, isStatement: boolean | number, optionalId?: boolean | undefined): Node {
    this.next();
    this.takeDecorators(node);
    this.parseClassId(node, isStatement, optionalId);
    this.parseClassSuper(node);
    this.parseClassBody(node);
    return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
  }

  isClassProperty(): boolean {
    return this.match(types.eq) || this.match(types.semi) || this.match(types.braceR);
  }

  isClassMethod(): boolean {
    return this.match(types.parenL);
  }

  isNonstaticConstructor(method: Node): boolean {
    return !method.computed && !method.static && (method.key.name === "constructor" || // Identifier
    method.key.value === "constructor") // String literal
    ;
  }

  parseClassBody(node: Node): void {
    // class bodies are implicitly strict
    var oldStrict = this.state.strict;
    this.state.strict = true;
    this.state.classLevel++;
    var state = {
      hadConstructor: false
    };
    var decorators = [];
    var classBody = this.startNode();
    classBody.body = [];
    this.expect(types.braceL);

    while (!this.eat(types.braceR)) {
      if (this.eat(types.semi)) {
        if (decorators!.length > 0) {
          this.raise(this.state.lastTokEnd, "Decorators must not be followed by a semicolon");
        }

        continue;
      }

      if (this.match(types.at)) {
        decorators.push(this.parseDecorator());
        continue;
      }

      var member = this.startNode(); // steal the decorators if there are any

      if (decorators!.length) {
        member.decorators = decorators!;
        this.resetStartLocationFromNode(member, decorators[0]);
        decorators = [];
      }

      this.parseClassMember(classBody, member, state);

      if (this.hasPlugin("decorators2") && ["method", "get", "set"].indexOf(member.kind!) === -1 && member.decorators && member.decorators!.length > 0) {
        this.raise(member.start, "Stage 2 decorators may only be used with a class or a class method");
      }
    }

    if (decorators!.length) {
      this.raise(this.state.start, "You have trailing decorators with no method");
    }

    node.body = this.finishNode(classBody, "ClassBody");
    this.state.classLevel--;
    this.state.strict = oldStrict;
  }

  parseClassMember(classBody: Node, member: Node, state: ClassBodyState): void {
    var isStatic = false;

    if (this.match(types.name) && this.state.value === "static") {
      var key = this.parseIdentifier(true); // eats 'static'

      if (this.isClassMethod()) {
        var method = member; // a method named 'static'

        method.kind = "method";
        method.computed = false;
        method.key = key;
        method.static = false;
        this.pushClassMethod(classBody, method, false, false,
        /* isConstructor */
        false);
        return;
      } else if (this.isClassProperty()) {
        var prop = member; // a property named 'static'

        prop.computed = false;
        prop.key = key;
        prop.static = false;
        nodeArray(classBody.body).push(this.parseClassProperty(prop));
        return;
      } // otherwise something static


      isStatic = true;
    }

    this.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
  }

  parseClassMemberWithIsStatic(classBody: Node, member: Node, state: ClassBodyState, isStatic: boolean): void {
    var publicMethod = member;
    var privateMethod = member;
    var publicProp = member;
    var privateProp = member;
    var method = publicMethod;
    var publicMember = publicMethod;
    member.static = isStatic;

    if (this.eat(types.star)) {
      // a generator
      method.kind = "method";
      this.parseClassPropertyName(method);

      if (method.key.type === "PrivateName") {
        // Private generator method
        this.pushClassPrivateMethod(classBody, privateMethod, true, false);
        return;
      }

      if (this.isNonstaticConstructor(publicMethod)) {
        this.raise(publicMethod.key.start, "Constructor can't be a generator");
      }

      this.pushClassMethod(classBody, publicMethod, true, false,
      /* isConstructor */
      false);
      return;
    }

    var key = this.parseClassPropertyName(member);
    var isPrivate = key.type === "PrivateName"; // Check the key is not a computed expression or string literal.

    var isSimple = key.type === "Identifier";
    this.parsePostMemberNameModifiers(publicMember);

    if (this.isClassMethod()) {
      method.kind = "method";

      if (isPrivate) {
        this.pushClassPrivateMethod(classBody, privateMethod, false, false);
        return;
      } // a normal method


      var isConstructor = this.isNonstaticConstructor(publicMethod);

      if (isConstructor) {
        publicMethod.kind = "constructor";

        if (publicMethod.decorators) {
          this.raise(publicMethod.start, "You can't attach decorators to a class constructor");
        } // TypeScript allows multiple overloaded constructor declarations.


        if (state.hadConstructor && !this.hasPlugin("typescript")) {
          this.raise(key.start, "Duplicate constructor in the same class");
        }

        state.hadConstructor = true;
      }

      this.pushClassMethod(classBody, publicMethod, false, false, isConstructor);
    } else if (this.isClassProperty()) {
      if (isPrivate) {
        this.pushClassPrivateProperty(classBody, privateProp);
      } else {
        this.pushClassProperty(classBody, publicProp);
      }
    } else if (isSimple && key.name === "async" && !this.isLineTerminator()) {
      // an async method
      var isGenerator = this.match(types.star);

      if (isGenerator) {
        this.expectPlugin("asyncGenerators");
        this.next();
      }

      method.kind = "method"; // The so-called parsed name would have been "async": get the real name.

      this.parseClassPropertyName(method);

      if (method.key.type === "PrivateName") {
        // private async method
        this.pushClassPrivateMethod(classBody, privateMethod, isGenerator, true);
      } else {
        if (this.isNonstaticConstructor(publicMethod)) {
          this.raise(publicMethod.key.start, "Constructor can't be an async function");
        }

        this.pushClassMethod(classBody, publicMethod, isGenerator, true,
        /* isConstructor */
        false);
      }
    } else if (isSimple && (key.name === "get" || key.name === "set") && !(this.isLineTerminator() && this.match(types.star))) {
      // `get\n*` is an uninitialized property named 'get' followed by a generator.
      // a getter or setter
      method.kind = key.name; // The so-called parsed name would have been "get/set": get the real name.

      this.parseClassPropertyName(publicMethod);

      if (method.key.type === "PrivateName") {
        // private getter/setter
        this.pushClassPrivateMethod(classBody, privateMethod, false, false);
      } else {
        if (this.isNonstaticConstructor(publicMethod)) {
          this.raise(publicMethod.key.start, "Constructor can't have get/set modifier");
        }

        this.pushClassMethod(classBody, publicMethod, false, false,
        /* isConstructor */
        false);
      }

      this.checkGetterSetterParamCount(publicMethod);
    } else if (this.isLineTerminator()) {
      // an uninitialized class property (due to ASI, since we don't otherwise recognize the next token)
      if (isPrivate) {
        this.pushClassPrivateProperty(classBody, privateProp);
      } else {
        this.pushClassProperty(classBody, publicProp);
      }
    } else {
      this.unexpected();
    }
  }

  parseClassPropertyName(member: Node): Node {
    var key = this.parsePropertyName(member);

    if (!member.computed && member.static && (key.name === "prototype" || key.value === "prototype")) {
      this.raise(key.start, "Classes may not have static property named prototype");
    }

    if (key.type === "PrivateName" && key.id!.name === "constructor") {
      this.raise(key.start, "Classes may not have a private field named '#constructor'");
    }

    return key;
  }

  pushClassProperty(classBody: Node, prop: Node): void {
    // This only affects properties, not methods.
    if (this.isNonstaticConstructor(prop)) {
      this.raise(prop.key.start, "Classes may not have a non-static field named 'constructor'");
    }

    nodeArray(classBody.body).push(this.parseClassProperty(prop));
  }

  pushClassPrivateProperty(classBody: Node, prop: Node): void {
    this.expectPlugin("classPrivateProperties", prop.key.start);
    nodeArray(classBody.body).push(this.parseClassPrivateProperty(prop));
  }

  pushClassMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean): void {
    nodeArray(classBody.body).push(this.parseMethod(method, isGenerator, isAsync, isConstructor, "ClassMethod"));
  }

  pushClassPrivateMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined): void {
    this.expectPlugin("classPrivateMethods", method.key.start);
    nodeArray(classBody.body).push(this.parseMethod(method, isGenerator, isAsync,
    /* isConstructor */
    false, "ClassPrivateMethod"));
  } // Overridden in typescript.js


  parsePostMemberNameModifiers(methodOrProp: Node): void {} // Overridden in typescript.js


  parseAccessModifier(): string | null | undefined {
    return undefined;
  }

  parseClassPrivateProperty(node: Node): Node {
    this.state.inClassProperty = true;
    node.value = this.eat(types.eq) ? this.parseMaybeAssign() : null;
    this.semicolon();
    this.state.inClassProperty = false;
    return this.finishNode(node, "ClassPrivateProperty");
  }

  parseClassProperty(node: Node): Node {
    if (!node.typeAnnotation) {
      this.expectPlugin("classProperties");
    }

    this.state.inClassProperty = true;

    if (this.match(types.eq)) {
      this.expectPlugin("classProperties");
      this.next();
      node.value = this.parseMaybeAssign();
    } else {
      node.value = null;
    }

    this.semicolon();
    this.state.inClassProperty = false;
    return this.finishNode(node, "ClassProperty");
  }

  parseClassId(node: Node, isStatement: boolean | number, optionalId: boolean | undefined): void {
    if (this.match(types.name)) {
      node.id = this.parseIdentifier();
    } else {
      if (optionalId || !isStatement) {
        node.id = null;
      } else {
        this.unexpected(null, "A class name is required");
      }
    }
  }

  parseClassSuper(node: Node): void {
    node.superClass = this.eat(types._extends) ? this.parseExprSubscripts() : null;
  } // Parses module export declaration.
  // TODO: better type. Node is an N.AnyExport.


  parseExport(node: Node): Node {
    // export * from '...'
    if (this.shouldParseExportStar()) {
      this.parseExportStar(node, this.hasPlugin("exportExtensions"));
      if (node.type === "ExportAllDeclaration") return node;
    } else if (this.hasPlugin("exportExtensions") && this.isExportDefaultSpecifier()) {
      var specifier = this.startNode();
      specifier.exported = this.parseIdentifier(true);
      var specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
      node.specifiers = specifiers;

      if (this.match(types.comma) && this.lookahead().type === types.star) {
        this.expect(types.comma);

        var _specifier = this.startNode();

        this.expect(types.star);
        this.expectContextual("as");
        _specifier.exported = this.parseIdentifier();
        specifiers.push(this.finishNode(_specifier, "ExportNamespaceSpecifier"));
      } else {
        this.parseExportSpecifiersMaybe(node);
      }

      this.parseExportFrom(node, true);
    } else if (this.eat(types._default)) {
      // export default ...
      var expr = this.startNode();
      var needsSemi = false;

      if (this.eat(types._function)) {
        expr = this.parseFunction(expr, true, false, false, true);
      } else if (this.isContextual("async") && this.lookahead().type === types._function) {
        // async function declaration
        this.eatContextual("async");
        this.eat(types._function);
        expr = this.parseFunction(expr, true, false, true, true);
      } else if (this.match(types._class)) {
        expr = this.parseClass(expr, true, true);
      } else {
        needsSemi = true;
        expr = this.parseMaybeAssign();
      }

      node.declaration = expr;
      if (needsSemi) this.semicolon();
      this.checkExport(node, true, true);
      return this.finishNode(node, "ExportDefaultDeclaration");
    } else if (this.shouldParseExportDeclaration()) {
      if (this.isContextual("async")) {
        var next = this.lookahead(); // export async;

        if (next.type !== types._function) {
          this.unexpected(next.start, "Unexpected token, expected function");
        }
      }

      node.specifiers = [];
      node.source = null;
      node.declaration = this.parseExportDeclaration(node);
    } else {
      // export { x, y as z } [from '...']
      node.declaration = null;
      node.specifiers = this.parseExportSpecifiers();
      this.parseExportFrom(node);
    }

    this.checkExport(node, true);
    return this.finishNode(node, "ExportNamedDeclaration");
  } // eslint-disable-next-line no-unused-vars


  parseExportDeclaration(node?: Node): Node | null {
    return this.parseStatement(true);
  }

  isExportDefaultSpecifier(): boolean {
    if (this.match(types.name)) {
      return this.state.value !== "async";
    }

    if (!this.match(types._default)) {
      return false;
    }

    var lookahead = this.lookahead();
    return lookahead.type === types.comma || lookahead.type === types.name && lookahead.value === "from";
  }

  parseExportSpecifiersMaybe(node: Node): void {
    if (this.eat(types.comma)) {
      node.specifiers = node.specifiers.concat(this.parseExportSpecifiers());
    }
  }

  parseExportFrom(node: Node, expect?: boolean | undefined): void {
    if (this.eatContextual("from")) {
      node.source = this.match(types.string) ? this.parseExprAtom() : this.unexpected();
      this.checkExport(node);
    } else {
      if (expect) {
        this.unexpected();
      } else {
        node.source = null;
      }
    }

    this.semicolon();
  }

  shouldParseExportStar(): boolean {
    return this.match(types.star);
  }

  parseExportStar(node: Node, allowNamed?: boolean): void {
    this.expect(types.star);

    if (allowNamed && this.isContextual("as")) {
      var specifier = this.startNodeAt(this.state.lastTokStart, this.state.lastTokStartLoc);
      this.next();
      specifier.exported = this.parseIdentifier(true);
      node.specifiers = [this.finishNode(specifier, "ExportNamespaceSpecifier")];
      this.parseExportSpecifiersMaybe(node);
      this.parseExportFrom(node, true);
    } else {
      this.parseExportFrom(node, true);
      this.finishNode(node, "ExportAllDeclaration");
    }
  }

  shouldParseExportDeclaration(): boolean {
    return this.state.type.keyword === "var" || this.state.type.keyword === "const" || this.state.type.keyword === "let" || this.state.type.keyword === "function" || this.state.type.keyword === "class" || this.isContextual("async") || this.match(types.at) && this.expectPlugin("decorators2");
  }

  checkExport(node: Node, checkNames?: boolean | undefined, isDefault?: boolean | undefined): void {
    if (checkNames) {
      // Check for duplicate exports
      if (isDefault) {
        // Default exports
        this.checkDuplicateExports(node, "default");
      } else if (node.specifiers && node.specifiers.length) {
        // Named exports
        for (var _i4 = 0, _node$specifiers2 = node.specifiers; _i4 < _node$specifiers2.length; _i4++) {
          var specifier = _node$specifiers2[_i4];
          this.checkDuplicateExports(specifier, stringValue(specifier.exported.name));
        }
      } else if (node.declaration) {
        // Exported declarations
        if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
          this.checkDuplicateExports(node, stringValue(node.declaration.id!.name));
        } else if (node.declaration.type === "VariableDeclaration") {
          for (var _i6 = 0, _node$declaration$dec2 = node.declaration.declarations; _i6 < _node$declaration$dec2.length; _i6++) {
            var declaration = _node$declaration$dec2[_i6];
            this.checkDeclaration(declaration.id!);
          }
        }
      }
    }

    var currentContextDecorators = this.state.decoratorStack[this.state.decoratorStack.length - 1];

    if (currentContextDecorators.length) {
      var isClass = node.declaration && (node.declaration.type === "ClassDeclaration" || node.declaration.type === "ClassExpression");

      if (!node.declaration || !isClass) {
        throw this.raise(node.start, "You can only use decorators on an export when exporting a class");
      }

      this.takeDecorators(node.declaration);
    }
  }

  checkDeclaration(node: Node): void {
    if (node.type === "ObjectPattern") {
      for (var _i8 = 0, _node$properties2 = node.properties; _i8 < _node$properties2.length; _i8++) {
        var prop = _node$properties2[_i8];
        // $FlowFixMe (prop may be an AssignmentProperty, in which case this does nothing?)
        this.checkDeclaration(prop);
      }
    } else if (node.type === "ArrayPattern") {
      for (var _i10 = 0, _node$elements2 = node.elements; _i10 < _node$elements2.length; _i10++) {
        var elem = _node$elements2[_i10];

        if (elem) {
          this.checkDeclaration(elem);
        }
      }
    } else if (node.type === "ObjectProperty") {
      this.checkDeclaration(nodeValue(node.value));
    } else if (node.type === "RestElement") {
      this.checkDeclaration(node.argument!);
    } else if (node.type === "Identifier") {
      this.checkDuplicateExports(node, stringValue(node.name));
    }
  }

  checkDuplicateExports(node: Node, name: string): void {
    if (this.state.exportedIdentifiers.indexOf(name) > -1) {
      this.raiseDuplicateExportError(node, name);
    }

    this.state.exportedIdentifiers.push(name);
  }

  raiseDuplicateExportError(node: Node, name: string): never {
    throw this.raise(node.start, name === "default" ? "Only one default export allowed per module." : `\`${name}\` has already been exported. Exported identifiers must be unique.`);
  } // Parses a comma-separated list of module exports.


  parseExportSpecifiers(): Node[] {
    var nodes = [];
    var first = true;
    var needsFrom; // export { x, y as z } [from '...']

    this.expect(types.braceL);

    while (!this.eat(types.braceR)) {
      if (first) {
        first = false;
      } else {
        this.expect(types.comma);
        if (this.eat(types.braceR)) break;
      }

      var isDefault = this.match(types._default);
      if (isDefault && !needsFrom) needsFrom = true;
      var node = this.startNode();
      node.local = this.parseIdentifier(isDefault);
      node.exported = this.eatContextual("as") ? this.parseIdentifier(true) : node.local.__clone();
      nodes.push(this.finishNode(node, "ExportSpecifier"));
    } // https://github.com/ember-cli/ember-cli/pull/3739


    if (needsFrom && !this.isContextual("from")) {
      this.unexpected();
    }

    return nodes;
  } // Parses import declaration.


  parseImport(node: Node): Node {
    // import '...'
    if (this.match(types.string)) {
      node.specifiers = [];
      node.source = this.parseExprAtom();
    } else {
      node.specifiers = [];
      this.parseImportSpecifiers(node);
      this.expectContextual("from");
      node.source = this.match(types.string) ? this.parseExprAtom() : this.unexpected();
    }

    this.semicolon();
    return this.finishNode(node, "ImportDeclaration");
  } // eslint-disable-next-line no-unused-vars


  shouldParseDefaultImport(node: Node): boolean {
    return this.match(types.name);
  }

  parseImportSpecifierLocal(node: Node, specifier: Node, type: string, contextDescription: string): void {
    specifier.local = this.parseIdentifier();
    this.checkLVal(specifier.local, true, undefined, contextDescription);
    node.specifiers.push(this.finishNode(specifier, type));
  } // Parses a comma-separated list of module imports.


  parseImportSpecifiers(node: Node): void {
    var first = true;

    if (this.shouldParseDefaultImport(node)) {
      // import defaultObj, { x, y as z } from '...'
      this.parseImportSpecifierLocal(node, this.startNode(), "ImportDefaultSpecifier", "default import specifier");
      if (!this.eat(types.comma)) return;
    }

    if (this.match(types.star)) {
      var specifier = this.startNode();
      this.next();
      this.expectContextual("as");
      this.parseImportSpecifierLocal(node, specifier, "ImportNamespaceSpecifier", "import namespace specifier");
      return;
    }

    this.expect(types.braceL);

    while (!this.eat(types.braceR)) {
      if (first) {
        first = false;
      } else {
        // Detect an attempt to deep destructure
        if (this.eat(types.colon)) {
          this.unexpected(null, "ES2015 named imports do not destructure. Use another statement for destructuring after the import.");
        }

        this.expect(types.comma);
        if (this.eat(types.braceR)) break;
      }

      this.parseImportSpecifier(node);
    }
  }

  parseImportSpecifier(node: Node): void {
    var specifier = this.startNode();
    specifier.imported = this.parseIdentifier(true);

    if (this.eatContextual("as")) {
      specifier.local = this.parseIdentifier();
    } else {
      this.checkReservedWord(specifier.imported.name!, specifier.start, true, true);
      specifier.local = specifier.imported.__clone();
    }

    this.checkLVal(specifier.local, true, undefined, "import specifier");
    node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
  }

  
}

var plugins: Record<string, (base: typeof Parser) => typeof Parser> = {};

class Parser extends StatementParser {
  

  constructor(options: Partial<ParserOptions> | undefined, input: string) {
    const normalizedOptions = getOptions(options);
    super(normalizedOptions, input);
    this.options = normalizedOptions;
    options = normalizedOptions;
    this.inModule = this.options.sourceType === "module";
    this.input = input;
    this.plugins = pluginsMap(this.options.plugins);
    this.filename = options.sourceFilename; // If enabled, skip leading hashbang line.

    if (this.state.pos === 0 && this.input[0] === "#" && this.input[1] === "!") {
      this.skipLineComment(2);
    }
}

  

  parse(): Node {
    var file = this.startNode();
    var program = this.startNode();
    this.nextToken();
    return this.parseTopLevel(file, program);
  }

  
}

function pluginsMap(pluginList: string[]): Record<string, boolean> {
  var pluginMap: Record<string, boolean> = {};

  for (var _i2 = 0; _i2 < pluginList.length; _i2++) {
    var _name = pluginList[_i2];
    pluginMap[_name] = true;
  }

  return pluginMap;
}

function isSimpleProperty(node: Node | null): boolean {
  return node != null && node.type === "Property" && node.kind === "init" && node.method === false;
}

var estreePlugin = (function (superClass: typeof Parser) {
  return (
    /*#__PURE__*/
    class _class extends superClass {
      

      

      

      estreeParseRegExpLiteral(_ref: RegExpValue): Node {
        var pattern = _ref.pattern,
            flags = _ref.flags;
        var regex = null;

        try {
          regex = new RegExp(pattern, flags);
        } catch (e) {// In environments that don't support these flags value will
          // be null as the regex can't be represented natively.
        }

        var node = this.estreeParseLiteral(regex);
        node.regex = {
          pattern,
          flags
        };
        return node;
      }

      estreeParseLiteral(value: NodeValue): Node {
        return this.parseLiteral(value, "Literal");
      }

      directiveToStmt(directive: Node): Node {
        var directiveLiteral = nodeValue(directive.value);
        var stmt = this.startNodeAt(directive.start, directive.loc.start);
        var expression = this.startNodeAt(directiveLiteral.start, directiveLiteral.loc.start);
        expression.value = directiveLiteral.value;
        expression.raw = directiveLiteral.extra!.raw!;
        stmt.expression = this.finishNodeAt(expression, "Literal", directiveLiteral.end, directiveLiteral.loc.end);
        stmt.directive = directiveLiteral.extra!.raw!.slice(1, -1);
        return this.finishNodeAt(stmt, "ExpressionStatement", directive.end, directive.loc.end);
      } // ==================================
      // Overrides
      // ==================================


      checkDeclaration(node: Node): void {
        if (isSimpleProperty(node)) {
          // $FlowFixMe
          this.checkDeclaration(nodeValue(node.value));
        } else {
          superClass.prototype.checkDeclaration.call(this, node);
        }
      }

      checkGetterSetterParamCount(prop: Node): void {
        var paramCount = prop.kind === "get" ? 0 : 1; // $FlowFixMe (prop.value present for ObjectMethod, but for ClassMethod should use prop.params?)

        if (nodeValue(prop.value).params.length !== paramCount) {
          var start = prop.start;

          if (prop.kind === "get") {
            this.raise(start, "getter should have no params");
          } else {
            this.raise(start, "setter should have exactly one param");
          }
        }
      }

      checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void {
        var _this = this;

        switch (expr.type) {
          case "ObjectPattern":
            expr.properties.forEach(function (prop) {
              _this.checkLVal(nodeValue(prop.type === "Property" ? prop.value : prop), isBinding, checkClashes, "object destructuring pattern");
            });
            break;

          default:
            superClass.prototype.checkLVal.call(this, expr, isBinding, checkClashes, contextDescription);

        }
      }

      checkPropClash(prop: Node, propHash: Record<string, boolean>): void {
        if (prop.computed || !isSimpleProperty(prop)) return;
        var key = prop.key; // It is either an Identifier or a String/NumericLiteral

        var name = key.type === "Identifier" ? key.name : String(key.value);

        if (name === "__proto__") {
          if (propHash.proto) {
            this.raise(key.start, "Redefinition of __proto__ property");
          }

          propHash.proto = true;
        }
      }

      isStrictBody(node: Node, isExpression: boolean | Node | null | undefined): boolean {
        if (!isExpression && nodeArray(nodeValue(node.body).body).length > 0) {
          for (var _i2 = 0, _node$body$body2 = nodeArray(nodeValue(node.body).body); _i2 < _node$body$body2.length; _i2++) {
            var directive = _node$body$body2[_i2];

            if (directive.type === "ExpressionStatement" && nodeValue(directive.expression).type === "Literal") {
              if (nodeValue(directive.expression).value === "use strict") return true;
            } else {
              // Break for the first non literal expression
              break;
            }
          }
        }

        return false;
      }

      isValidDirective(stmt: Node): boolean {
        return stmt.type === "ExpressionStatement" && nodeValue(stmt.expression).type === "Literal" && typeof nodeValue(stmt.expression).value === "string" && (!nodeValue(stmt.expression).extra || !nodeValue(stmt.expression).extra!.parenthesized);
      }

      stmtToDirective(stmt: Node): Node {
        var directive = superClass.prototype.stmtToDirective.call(this, stmt);

        var value = nodeValue(stmt.expression).value; // Reset value to the actual value as in estree mode we want
        // the stmt to have the real value and not the raw value

        nodeValue(directive.value).value = value;
        return directive;
      }

      parseBlockBody(node: Node, allowDirectives: boolean | undefined, topLevel: boolean | undefined, end: TokenType): void {
        var _this2 = this;

        superClass.prototype.parseBlockBody.call(this, node, allowDirectives, topLevel, end);

        var directiveStatements = node.directives.map(function (d) {
          return _this2.directiveToStmt(d);
        });
        node.body = directiveStatements.concat(node.body);
        removeField(node, "directives");
      }

      pushClassMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean): void {
        this.parseMethod(method, isGenerator, isAsync, isConstructor, "MethodDefinition");

        if (method.typeParameters) {
          // $FlowIgnore
          nodeValue(method.value).typeParameters = method.typeParameters;
          removeField(method, "typeParameters");
        }

        nodeArray(classBody.body).push(method);
      }

      parseExprAtom(refShorthandDefaultPos?: StartReference): Node {
        switch (this.state.type) {
          case types.regexp:
            return this.estreeParseRegExpLiteral(regexpValue(this.state.value));

          case types.num:
          case types.string:
            return this.estreeParseLiteral(this.state.value);

          case types._null:
            return this.estreeParseLiteral(null);

          case types._true:
            return this.estreeParseLiteral(true);

          case types._false:
            return this.estreeParseLiteral(false);

          default:
            return superClass.prototype.parseExprAtom.call(this, refShorthandDefaultPos);
        }
      }

      parseLiteral(value: NodeValue, type: string, startPos?: number, startLoc?: Position): Node {
        var node = superClass.prototype.parseLiteral.call(this, value, type, startPos, startLoc);

        node.raw = node.extra!.raw!;
        removeField(node, "extra");
        return node;
      }

      parseMethod(node: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean, type?: string): Node {
        var funcNode = this.startNode();
        funcNode.kind = node.kind; // provide kind, so super method correctly sets state

        funcNode = superClass.prototype.parseMethod.call(this, funcNode, isGenerator, isAsync, isConstructor, "FunctionExpression");
        removeField(funcNode, "kind"); // $FlowIgnore

        node.value = funcNode;
        return this.finishNode(node, type);
      }

      parseObjectMethod(prop: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined): Node | undefined {
        var node = superClass.prototype.parseObjectMethod.call(this, prop, isGenerator, isAsync, isPattern);

        if (node) {
          node.type = "Property";
          if (node.kind === "method") node.kind = "init";
          node.shorthand = false;
        }

        return node;
      }

      parseObjectProperty(prop: Node, startPos: number | undefined, startLoc: Position | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined {
        var node = superClass.prototype.parseObjectProperty.call(this, prop, startPos, startLoc, isPattern, refShorthandDefaultPos);

        if (node) {
          node.kind = "init";
          node.type = "Property";
        }

        return node;
      }

      toAssignable(node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null {
        if (isSimpleProperty(node)) {
          this.toAssignable(nodeValue(node!.value), isBinding, contextDescription);
          return node;
        }

        return superClass.prototype.toAssignable.call(this, node, isBinding, contextDescription);
      }

      toAssignableObjectExpressionProp(prop: Node, isBinding?: boolean, isLast?: boolean): void {
        if (prop.kind === "get" || prop.kind === "set") {
          this.raise(prop.key.start, "Object pattern can't contain getter or setter");
        } else if (prop.method) {
          this.raise(prop.key.start, "Object pattern can't contain methods");
        } else {
          superClass.prototype.toAssignableObjectExpressionProp.call(this, prop, isBinding, isLast);
        }
      }

      
}
  );
});

/* eslint max-len: 0 */
var primitiveTypes = ["any", "bool", "boolean", "empty", "false", "mixed", "null", "number", "static", "string", "true", "typeof", "void"];

function isEsModuleType(bodyElement: Node): boolean {
  return bodyElement.type === "DeclareExportAllDeclaration" || bodyElement.type === "DeclareExportDeclaration" && (!bodyElement.declaration || bodyElement.declaration.type !== "TypeAlias" && bodyElement.declaration.type !== "InterfaceDeclaration");
}

function hasTypeImportKind(node: Node): boolean {
  return node.importKind === "type" || node.importKind === "typeof";
}

function isMaybeDefaultImport(state: State): boolean {
  return (state.type === types.name || !!state.type.keyword) && state.value !== "from";
}

var exportSuggestions: Record<string, string> = {
  const: "declare export var",
  let: "declare export var",
  type: "export type",
  interface: "export interface"
}; // Like Array#filter, but returns a tuple [ acceptedElements, discardedElements ]

function partition<T>(list: T[], test: (value: T, index: number, list: T[]) => boolean): [T[], T[]] {
  var list1: T[] = [];
  var list2: T[] = [];

  for (var i = 0; i < list.length; i++) {
    (test(list[i], i, list) ? list1 : list2).push(list[i]);
  }

  return [list1, list2];
}

var flowPlugin = (function (superClass: typeof Parser) {
  return (
    /*#__PURE__*/
    class _class extends superClass {
      

      

      

      flowParseTypeInitialiser(tok?: TokenType): Node {
        var oldInType = this.state.inType;
        this.state.inType = true;
        this.expect(tok || types.colon);
        var type = this.flowParseType();
        this.state.inType = oldInType;
        return type;
      }

      flowParsePredicate(): Node {
        var node = this.startNode();
        var moduloLoc = this.state.startLoc;
        var moduloPos = this.state.start;
        this.expect(types.modulo);
        var checksLoc = this.state.startLoc;
        this.expectContextual("checks"); // Force '%' and 'checks' to be adjacent

        if (moduloLoc.line !== checksLoc.line || moduloLoc.column !== checksLoc.column - 1) {
          this.raise(moduloPos, "Spaces between ´%´ and ´checks´ are not allowed here.");
        }

        if (this.eat(types.parenL)) {
          node.value = this.parseExpression();
          this.expect(types.parenR);
          return this.finishNode(node, "DeclaredPredicate");
        } else {
          return this.finishNode(node, "InferredPredicate");
        }
      }

      flowParseTypeAndPredicateInitialiser(): [Node | null, Node | null] {
        var oldInType = this.state.inType;
        this.state.inType = true;
        this.expect(types.colon);
        var type = null;
        var predicate = null;

        if (this.match(types.modulo)) {
          this.state.inType = oldInType;
          predicate = this.flowParsePredicate();
        } else {
          type = this.flowParseType();
          this.state.inType = oldInType;

          if (this.match(types.modulo)) {
            predicate = this.flowParsePredicate();
          }
        }

        return [type, predicate];
      }

      flowParseDeclareClass(node: Node): Node {
        this.next();
        this.flowParseInterfaceish(node);
        return this.finishNode(node, "DeclareClass");
      }

      flowParseDeclareFunction(node: Node): Node {
        this.next();
        var id = node.id = this.parseIdentifier();
        var typeNode = this.startNode();
        var typeContainer = this.startNode();

        if (this.isRelational("<")) {
          typeNode.typeParameters = this.flowParseTypeParameterDeclaration();
        } else {
          typeNode.typeParameters = null;
        }

        this.expect(types.parenL);
        var tmp = this.flowParseFunctionTypeParams();
        typeNode.params = tmp.params;
        typeNode.rest = tmp.rest;
        this.expect(types.parenR);

        var _flowParseTypeAndPred = this.flowParseTypeAndPredicateInitialiser();

        // $FlowFixMe (destructuring not supported yet)
        typeNode.returnType = _flowParseTypeAndPred[0];
        // $FlowFixMe (destructuring not supported yet)
        node.predicate = _flowParseTypeAndPred[1];
        typeContainer.typeAnnotation = this.finishNode(typeNode, "FunctionTypeAnnotation");
        id.typeAnnotation = this.finishNode(typeContainer, "TypeAnnotation");
        this.finishNode(id, id.type);
        this.semicolon();
        return this.finishNode(node, "DeclareFunction");
      }

      flowParseDeclare(node: Node, insideModule?: boolean): Node {
        if (this.match(types._class)) {
          return this.flowParseDeclareClass(node);
        } else if (this.match(types._function)) {
          return this.flowParseDeclareFunction(node);
        } else if (this.match(types._var)) {
          return this.flowParseDeclareVariable(node);
        } else if (this.isContextual("module")) {
          if (this.lookahead().type === types.dot) {
            return this.flowParseDeclareModuleExports(node);
          } else {
            if (insideModule) {
              this.unexpected(null, "`declare module` cannot be used inside another `declare module`");
            }

            return this.flowParseDeclareModule(node);
          }
        } else if (this.isContextual("type")) {
          return this.flowParseDeclareTypeAlias(node);
        } else if (this.isContextual("opaque")) {
          return this.flowParseDeclareOpaqueType(node);
        } else if (this.isContextual("interface")) {
          return this.flowParseDeclareInterface(node);
        } else if (this.match(types._export)) {
          return this.flowParseDeclareExportDeclaration(node, insideModule);
        } else {
          throw this.unexpected();
        }
      }

      flowParseDeclareVariable(node: Node): Node {
        this.next();
        node.id = this.flowParseTypeAnnotatableIdentifier(
        /*allowPrimitiveOverride*/
        true);
        this.semicolon();
        return this.finishNode(node, "DeclareVariable");
      }

      flowParseDeclareModule(node: Node): Node {
        var _this = this;

        this.next();

        if (this.match(types.string)) {
          node.id = this.parseExprAtom();
        } else {
          node.id = this.parseIdentifier();
        }

        var bodyNode = node.body = this.startNode();
        var body: Node[] = bodyNode.body = [];
        this.expect(types.braceL);

        while (!this.match(types.braceR)) {
          var _bodyNode = this.startNode();

          if (this.match(types._import)) {
            var lookahead = this.lookahead();

            if (lookahead.value !== "type" && lookahead.value !== "typeof") {
              this.unexpected(null, "Imports within a `declare module` body must always be `import type` or `import typeof`");
            }

            this.next();
            this.parseImport(_bodyNode);
          } else {
            this.expectContextual("declare", "Only declares and type imports are allowed inside declare module");
            _bodyNode = this.flowParseDeclare(_bodyNode, true);
          }

          body.push(_bodyNode);
        }

        this.expect(types.braceR);
        this.finishNode(bodyNode, "BlockStatement");
        var kind: string | null = null;
        var hasModuleExport = false;
        var errorMessage = "Found both `declare module.exports` and `declare export` in the same module. Modules can only have 1 since they are either an ES module or they are a CommonJS module";
        body.forEach(function (bodyElement) {
          if (isEsModuleType(bodyElement)) {
            if (kind === "CommonJS") {
              _this.unexpected(bodyElement.start, errorMessage);
            }

            kind = "ES";
          } else if (bodyElement.type === "DeclareModuleExports") {
            if (hasModuleExport) {
              _this.unexpected(bodyElement.start, "Duplicate `declare module.exports` statement");
            }

            if (kind === "ES") _this.unexpected(bodyElement.start, errorMessage);
            kind = "CommonJS";
            hasModuleExport = true;
          }
        });
        node.kind = kind || "CommonJS";
        return this.finishNode(node, "DeclareModule");
      }

      flowParseDeclareExportDeclaration(node: Node, insideModule?: boolean): Node {
        this.expect(types._export);

        if (this.eat(types._default)) {
          if (this.match(types._function) || this.match(types._class)) {
            // declare export default class ...
            // declare export default function ...
            node.declaration = this.flowParseDeclare(this.startNode());
          } else {
            // declare export default [type];
            node.declaration = this.flowParseType();
            this.semicolon();
          }

          node.default = true;
          return this.finishNode(node, "DeclareExportDeclaration");
        } else {
          if (this.match(types._const) || this.match(types._let) || (this.isContextual("type") || this.isContextual("interface")) && !insideModule) {
            var label = stringValue(this.state.value);
            var suggestion = exportSuggestions[label];
            this.unexpected(this.state.start, `\`declare export ${label}\` is not supported. Use \`${suggestion}\` instead`);
          }

          if (this.match(types._var) || // declare export var ...
          this.match(types._function) || // declare export function ...
          this.match(types._class) || // declare export class ...
          this.isContextual("opaque") // declare export opaque ..
          ) {
              node.declaration = this.flowParseDeclare(this.startNode());
              node.default = false;
              return this.finishNode(node, "DeclareExportDeclaration");
            } else if (this.match(types.star) || // declare export * from ''
          this.match(types.braceL) || // declare export {} ...
          this.isContextual("interface") || // declare export interface ...
          this.isContextual("type") || // declare export type ...
          this.isContextual("opaque") // declare export opaque type ...
          ) {
              node = this.parseExport(node);

              if (node.type === "ExportNamedDeclaration") {
                // flow does not support the ExportNamedDeclaration
                // $FlowIgnore
                node.type = "ExportDeclaration"; // $FlowFixMe

                node.default = false;
                removeField(node, "exportKind");
              } // $FlowIgnore


              node.type = "Declare" + node.type;
              return node;
            }
        }

        throw this.unexpected();
      }

      flowParseDeclareModuleExports(node: Node): Node {
        this.expectContextual("module");
        this.expect(types.dot);
        this.expectContextual("exports");
        node.typeAnnotation = this.flowParseTypeAnnotation();
        this.semicolon();
        return this.finishNode(node, "DeclareModuleExports");
      }

      flowParseDeclareTypeAlias(node: Node): Node {
        this.next();
        this.flowParseTypeAlias(node);
        return this.finishNode(node, "DeclareTypeAlias");
      }

      flowParseDeclareOpaqueType(node: Node): Node {
        this.next();
        this.flowParseOpaqueType(node, true);
        return this.finishNode(node, "DeclareOpaqueType");
      }

      flowParseDeclareInterface(node: Node): Node {
        this.next();
        this.flowParseInterfaceish(node);
        return this.finishNode(node, "DeclareInterface");
      } // Interfaces


      flowParseInterfaceish(node: Node): void {
        node.id = this.parseIdentifier();

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
        } else {
          node.typeParameters = null;
        }

        node.extends = [];
        node.mixins = [];

        if (this.eat(types._extends)) {
          do {
            node.extends.push(this.flowParseInterfaceExtends());
          } while (this.eat(types.comma));
        }

        if (this.isContextual("mixins")) {
          this.next();

          do {
            node.mixins.push(this.flowParseInterfaceExtends());
          } while (this.eat(types.comma));
        }

        node.body = this.flowParseObjectType(true, false, false);
      }

      flowParseInterfaceExtends(): Node {
        var node = this.startNode();
        node.id = this.flowParseQualifiedTypeIdentifier();

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterInstantiation();
        } else {
          node.typeParameters = null;
        }

        return this.finishNode(node, "InterfaceExtends");
      }

      flowParseInterface(node: Node): Node {
        this.flowParseInterfaceish(node);
        return this.finishNode(node, "InterfaceDeclaration");
      }

      checkReservedType(word: string, startLoc: number): void {
        if (primitiveTypes.indexOf(word) > -1) {
          this.raise(startLoc, `Cannot overwrite primitive type ${word}`);
        }
      }

      flowParseRestrictedIdentifier(liberal?: boolean | undefined): Node {
        this.checkReservedType(stringValue(this.state.value), this.state.start);
        return this.parseIdentifier(liberal);
      } // Type aliases


      flowParseTypeAlias(node: Node): Node {
        node.id = this.flowParseRestrictedIdentifier();

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
        } else {
          node.typeParameters = null;
        }

        node.right = this.flowParseTypeInitialiser(types.eq);
        this.semicolon();
        return this.finishNode(node, "TypeAlias");
      }

      flowParseOpaqueType(node: Node, declare?: boolean): Node {
        this.expectContextual("type");
        node.id = this.flowParseRestrictedIdentifier();

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
        } else {
          node.typeParameters = null;
        } // Parse the supertype


        node.supertype = null;

        if (this.match(types.colon)) {
          node.supertype = this.flowParseTypeInitialiser(types.colon);
        }

        node.impltype = null;

        if (!declare) {
          node.impltype = this.flowParseTypeInitialiser(types.eq);
        }

        this.semicolon();
        return this.finishNode(node, "OpaqueType");
      } // Type annotations


      flowParseTypeParameter(requireDefault?: boolean): Node {
        var node = this.startNode();
        var variance = this.flowParseVariance();
        var ident = this.flowParseTypeAnnotatableIdentifier();
        node.name = ident.name;
        node.variance = variance;
        node.bound = ident.typeAnnotation!;

        if (this.match(types.eq)) {
          this.eat(types.eq);
          node.default = this.flowParseType();
        }

        return this.finishNode(node, "TypeParameter");
      }

      flowParseTypeParameterDeclaration(): Node {
        var oldInType = this.state.inType;
        var node = this.startNode();
        node.params = [];
        this.state.inType = true; // istanbul ignore else: this condition is already checked at all call sites

        if (this.isRelational("<") || this.match(types.jsxTagStart)) {
          this.next();
        } else {
          this.unexpected();
        }

        do {
          node.params.push(this.flowParseTypeParameter());

          if (!this.isRelational(">")) {
            this.expect(types.comma);
          }
        } while (!this.isRelational(">"));

        this.expectRelational(">");
        this.state.inType = oldInType;
        return this.finishNode(node, "TypeParameterDeclaration");
      }

      flowParseTypeParameterInstantiation(call?: boolean): Node {
        var node = this.startNode();
        var oldInType = this.state.inType;
        node.params = [];
        this.state.inType = true;
        this.expectRelational("<");

        while (!this.isRelational(">")) {
          node.params.push(this.flowParseType());

          if (!this.isRelational(">")) {
            this.expect(types.comma);
          }
        }

        this.expectRelational(">");
        this.state.inType = oldInType;
        return this.finishNode(node, "TypeParameterInstantiation");
      }

      flowParseObjectPropertyKey(): Node {
        return this.match(types.num) || this.match(types.string) ? this.parseExprAtom() : this.parseIdentifier(true);
      }

      flowParseObjectTypeIndexer(node: Node, isStatic: boolean | undefined, variance: Node | null): Node {
        node.static = isStatic;
        this.expect(types.bracketL);

        if (this.lookahead().type === types.colon) {
          node.id = this.flowParseObjectPropertyKey();
          node.key = this.flowParseTypeInitialiser();
        } else {
          node.id = null;
          node.key = this.flowParseType();
        }

        this.expect(types.bracketR);
        node.value = this.flowParseTypeInitialiser();
        node.variance = variance;
        return this.finishNode(node, "ObjectTypeIndexer");
      }

      flowParseObjectTypeMethodish(node: Node): Node {
        node.params = [];
        node.rest = null;
        node.typeParameters = null;

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
        }

        this.expect(types.parenL);

        while (!this.match(types.parenR) && !this.match(types.ellipsis)) {
          node.params.push(this.flowParseFunctionTypeParam());

          if (!this.match(types.parenR)) {
            this.expect(types.comma);
          }
        }

        if (this.eat(types.ellipsis)) {
          node.rest = this.flowParseFunctionTypeParam();
        }

        this.expect(types.parenR);
        node.returnType = this.flowParseTypeInitialiser();
        return this.finishNode(node, "FunctionTypeAnnotation");
      }

      flowParseObjectTypeCallProperty(node: Node, isStatic: boolean | undefined): Node {
        var valueNode = this.startNode();
        node.static = isStatic;
        node.value = this.flowParseObjectTypeMethodish(valueNode);
        return this.finishNode(node, "ObjectTypeCallProperty");
      }

      flowParseObjectType(allowStatic: boolean | undefined, allowExact: boolean | undefined, allowSpread: boolean | undefined): Node {
        var oldInType = this.state.inType;
        this.state.inType = true;
        var nodeStart = this.startNode();
        nodeStart.callProperties = [];
        nodeStart.properties = [];
        nodeStart.indexers = [];
        var endDelim;
        var exact;

        if (allowExact && this.match(types.braceBarL)) {
          this.expect(types.braceBarL);
          endDelim = types.braceBarR;
          exact = true;
        } else {
          this.expect(types.braceL);
          endDelim = types.braceR;
          exact = false;
        }

        nodeStart.exact = exact;

        while (!this.match(endDelim)) {
          var isStatic = false;
          var node = this.startNode();

          if (allowStatic && this.isContextual("static") && this.lookahead().type !== types.colon) {
            this.next();
            isStatic = true;
          }

          var variance = this.flowParseVariance();

          if (this.match(types.bracketL)) {
            nodeStart.indexers.push(this.flowParseObjectTypeIndexer(node, isStatic, variance));
          } else if (this.match(types.parenL) || this.isRelational("<")) {
            if (variance) {
              this.unexpected(variance.start);
            }

            nodeStart.callProperties.push(this.flowParseObjectTypeCallProperty(node, isStatic));
          } else {
            var kind = "init";

            if (this.isContextual("get") || this.isContextual("set")) {
              var lookahead = this.lookahead();

              if (lookahead.type === types.name || lookahead.type === types.string || lookahead.type === types.num) {
                kind = stringValue(this.state.value);
                this.next();
              }
            }

            nodeStart.properties.push(this.flowParseObjectTypeProperty(node, isStatic, variance, kind, allowSpread));
          }

          this.flowObjectTypeSemicolon();
        }

        this.expect(endDelim);
        var out = this.finishNode(nodeStart, "ObjectTypeAnnotation");
        this.state.inType = oldInType;
        return out;
      }

      flowParseObjectTypeProperty(node: Node, isStatic: boolean | undefined, variance: Node | null, kind: string, allowSpread?: boolean): Node {
        if (this.match(types.ellipsis)) {
          if (!allowSpread) {
            this.unexpected(null, "Spread operator cannot appear in class or interface definitions");
          }

          if (variance) {
            this.unexpected(variance.start, "Spread properties cannot have variance");
          }

          this.expect(types.ellipsis);
          node.argument = this.flowParseType();
          return this.finishNode(node, "ObjectTypeSpreadProperty");
        } else {
          node.key = this.flowParseObjectPropertyKey();
          node.static = isStatic;
          node.kind = kind;
          var optional = false;

          if (this.isRelational("<") || this.match(types.parenL)) {
            // This is a method property
            if (variance) {
              this.unexpected(variance.start);
            }

            node.value = this.flowParseObjectTypeMethodish(this.startNodeAt(node.start, node.loc.start));

            if (kind === "get" || kind === "set") {
              this.flowCheckGetterSetterParamCount(node);
            }
          } else {
            if (kind !== "init") this.unexpected();

            if (this.eat(types.question)) {
              optional = true;
            }

            node.value = this.flowParseTypeInitialiser();
            node.variance = variance;
          }

          node.optional = optional;
          return this.finishNode(node, "ObjectTypeProperty");
        }
      } // This is similar to checkGetterSetterParamCount, but as
      // babylon uses non estree properties we cannot reuse it here


      flowCheckGetterSetterParamCount(property: Node): void {
        var paramCount = property.kind === "get" ? 0 : 1;

        if (nodeValue(property.value).params.length !== paramCount) {
          var start = property.start;

          if (property.kind === "get") {
            this.raise(start, "getter should have no params");
          } else {
            this.raise(start, "setter should have exactly one param");
          }
        }
      }

      flowObjectTypeSemicolon(): void {
        if (!this.eat(types.semi) && !this.eat(types.comma) && !this.match(types.braceR) && !this.match(types.braceBarR)) {
          this.unexpected();
        }
      }

      flowParseQualifiedTypeIdentifier(startPos?: number, startLoc?: Position, id?: Node): Node {
        startPos = startPos || this.state.start;
        startLoc = startLoc || this.state.startLoc;
        var node = id || this.parseIdentifier();

        while (this.eat(types.dot)) {
          var node2 = this.startNodeAt(startPos!, startLoc);
          node2.qualification = node;
          node2.id = this.parseIdentifier();
          node = this.finishNode(node2, "QualifiedTypeIdentifier");
        }

        return node;
      }

      flowParseGenericType(startPos: number, startLoc: Position, id: Node): Node {
        var node = this.startNodeAt(startPos!, startLoc);
        node.typeParameters = null;
        node.id = this.flowParseQualifiedTypeIdentifier(startPos, startLoc, id);

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterInstantiation();
        }

        return this.finishNode(node, "GenericTypeAnnotation");
      }

      flowParseTypeofType(): Node {
        var node = this.startNode();
        this.expect(types._typeof);
        node.argument = this.flowParsePrimaryType();
        return this.finishNode(node, "TypeofTypeAnnotation");
      }

      flowParseTupleType(): Node {
        var node = this.startNode();
        node.types = [];
        this.expect(types.bracketL); // We allow trailing commas

        while (this.state.pos < this.input.length && !this.match(types.bracketR)) {
          node.types.push(this.flowParseType());
          if (this.match(types.bracketR)) break;
          this.expect(types.comma);
        }

        this.expect(types.bracketR);
        return this.finishNode(node, "TupleTypeAnnotation");
      }

      flowParseFunctionTypeParam(): Node {
        var name = null;
        var optional = false;
        var typeAnnotation = null;
        var node = this.startNode();
        var lh = this.lookahead();

        if (lh.type === types.colon || lh.type === types.question) {
          name = this.parseIdentifier();

          if (this.eat(types.question)) {
            optional = true;
          }

          typeAnnotation = this.flowParseTypeInitialiser();
        } else {
          typeAnnotation = this.flowParseType();
        }

        node.name = name;
        node.optional = optional;
        node.typeAnnotation = typeAnnotation;
        return this.finishNode(node, "FunctionTypeParam");
      }

      reinterpretTypeAsFunctionTypeParam(type: Node): Node {
        var node = this.startNodeAt(type.start, type.loc.start);
        node.name = null;
        node.optional = false;
        node.typeAnnotation = type;
        return this.finishNode(node, "FunctionTypeParam");
      }

      flowParseFunctionTypeParams(params?: (Node | null)[]): FunctionTypeParameters {
        if (params === void 0) {
          params = [];
        }

        var rest = null;

        while (!this.match(types.parenR) && !this.match(types.ellipsis)) {
          params.push(this.flowParseFunctionTypeParam());

          if (!this.match(types.parenR)) {
            this.expect(types.comma);
          }
        }

        if (this.eat(types.ellipsis)) {
          rest = this.flowParseFunctionTypeParam();
        }

        return {
          params,
          rest
        };
      }

      flowIdentToTypeAnnotation(startPos: number, startLoc: Position, node: Node, id: Node): Node {
        switch (id.name) {
          case "any":
            return this.finishNode(node, "AnyTypeAnnotation");

          case "void":
            return this.finishNode(node, "VoidTypeAnnotation");

          case "bool":
          case "boolean":
            return this.finishNode(node, "BooleanTypeAnnotation");

          case "mixed":
            return this.finishNode(node, "MixedTypeAnnotation");

          case "empty":
            return this.finishNode(node, "EmptyTypeAnnotation");

          case "number":
            return this.finishNode(node, "NumberTypeAnnotation");

          case "string":
            return this.finishNode(node, "StringTypeAnnotation");

          default:
            return this.flowParseGenericType(startPos, startLoc, id);
        }
      } // The parsing of types roughly parallels the parsing of expressions, and
      // primary types are kind of like primary expressions...they're the
      // primitives with which other types are constructed.


      flowParsePrimaryType(): Node {
        var startPos = this.state.start;
        var startLoc = this.state.startLoc;
        var node = this.startNode();
        var tmp;
        var type;
        var isGroupedType = false;
        var oldNoAnonFunctionType = this.state.noAnonFunctionType;

        switch (this.state.type) {
          case types.name:
            return this.flowIdentToTypeAnnotation(startPos, startLoc, node, this.parseIdentifier());

          case types.braceL:
            return this.flowParseObjectType(false, false, true);

          case types.braceBarL:
            return this.flowParseObjectType(false, true, true);

          case types.bracketL:
            return this.flowParseTupleType();

          case types.relational:
            if (this.state.value === "<") {
              node.typeParameters = this.flowParseTypeParameterDeclaration();
              this.expect(types.parenL);
              tmp = this.flowParseFunctionTypeParams();
              node.params = tmp.params;
              node.rest = tmp.rest;
              this.expect(types.parenR);
              this.expect(types.arrow);
              node.returnType = this.flowParseType();
              return this.finishNode(node, "FunctionTypeAnnotation");
            }

            break;

          case types.parenL:
            this.next(); // Check to see if this is actually a grouped type

            if (!this.match(types.parenR) && !this.match(types.ellipsis)) {
              if (this.match(types.name)) {
                var token = this.lookahead().type;
                isGroupedType = token !== types.question && token !== types.colon;
              } else {
                isGroupedType = true;
              }
            }

            if (isGroupedType) {
              this.state.noAnonFunctionType = false;
              type = this.flowParseType();
              this.state.noAnonFunctionType = oldNoAnonFunctionType; // A `,` or a `) =>` means this is an anonymous function type

              if (this.state.noAnonFunctionType || !(this.match(types.comma) || this.match(types.parenR) && this.lookahead().type === types.arrow)) {
                this.expect(types.parenR);
                return type;
              } else {
                // Eat a comma if there is one
                this.eat(types.comma);
              }
            }

            if (type) {
              tmp = this.flowParseFunctionTypeParams([this.reinterpretTypeAsFunctionTypeParam(type)]);
            } else {
              tmp = this.flowParseFunctionTypeParams();
            }

            node.params = tmp.params;
            node.rest = tmp.rest;
            this.expect(types.parenR);
            this.expect(types.arrow);
            node.returnType = this.flowParseType();
            node.typeParameters = null;
            return this.finishNode(node, "FunctionTypeAnnotation");

          case types.string:
            return this.parseLiteral(this.state.value, "StringLiteralTypeAnnotation");

          case types._true:
          case types._false:
            node.value = this.match(types._true);
            this.next();
            return this.finishNode(node, "BooleanLiteralTypeAnnotation");

          case types.plusMin:
            if (this.state.value === "-") {
              this.next();

              if (!this.match(types.num)) {
                this.unexpected(null, "Unexpected token, expected number");
              }

              return this.parseLiteral(-this.state.value, "NumberLiteralTypeAnnotation", node.start, node.loc.start);
            }

            this.unexpected();

          case types.num:
            return this.parseLiteral(this.state.value, "NumberLiteralTypeAnnotation");

          case types._null:
            this.next();
            return this.finishNode(node, "NullLiteralTypeAnnotation");

          case types._this:
            this.next();
            return this.finishNode(node, "ThisTypeAnnotation");

          case types.star:
            this.next();
            return this.finishNode(node, "ExistsTypeAnnotation");

          default:
            if (this.state.type.keyword === "typeof") {
              return this.flowParseTypeofType();
            }

        }

        throw this.unexpected();
      }

      flowParsePostfixType(): Node {
        var startPos = this.state.start,
            startLoc = this.state.startLoc;
        var type = this.flowParsePrimaryType();

        while (!this.canInsertSemicolon() && this.match(types.bracketL)) {
          var node = this.startNodeAt(startPos!, startLoc);
          node.elementType = type;
          this.expect(types.bracketL);
          this.expect(types.bracketR);
          type = this.finishNode(node, "ArrayTypeAnnotation");
        }

        return type;
      }

      flowParsePrefixType(): Node {
        var node = this.startNode();

        if (this.eat(types.question)) {
          node.typeAnnotation = this.flowParsePrefixType();
          return this.finishNode(node, "NullableTypeAnnotation");
        } else {
          return this.flowParsePostfixType();
        }
      }

      flowParseAnonFunctionWithoutParens(): Node {
        var param = this.flowParsePrefixType();

        if (!this.state.noAnonFunctionType && this.eat(types.arrow)) {
          // TODO: This should be a type error. Passing in a SourceLocation, and it expects a Position.
          var node = this.startNodeAt(param.start, param.loc.start);
          node.params = [this.reinterpretTypeAsFunctionTypeParam(param)];
          node.rest = null;
          node.returnType = this.flowParseType();
          node.typeParameters = null;
          return this.finishNode(node, "FunctionTypeAnnotation");
        }

        return param;
      }

      flowParseIntersectionType(): Node {
        var node = this.startNode();
        this.eat(types.bitwiseAND);
        var type = this.flowParseAnonFunctionWithoutParens();
        node.types = [type];

        while (this.eat(types.bitwiseAND)) {
          node.types.push(this.flowParseAnonFunctionWithoutParens());
        }

        return node.types.length === 1 ? type : this.finishNode(node, "IntersectionTypeAnnotation");
      }

      flowParseUnionType(): Node {
        var node = this.startNode();
        this.eat(types.bitwiseOR);
        var type = this.flowParseIntersectionType();
        node.types = [type];

        while (this.eat(types.bitwiseOR)) {
          node.types.push(this.flowParseIntersectionType());
        }

        return node.types.length === 1 ? type : this.finishNode(node, "UnionTypeAnnotation");
      }

      flowParseType(): Node {
        var oldInType = this.state.inType;
        this.state.inType = true;
        var type = this.flowParseUnionType();
        this.state.inType = oldInType; // Ensure that a brace after a function generic type annotation is a
        // statement, except in arrow functions (noAnonFunctionType)

        this.state.exprAllowed = this.state.exprAllowed || this.state.noAnonFunctionType;
        return type;
      }

      flowParseTypeAnnotation(): Node {
        var node = this.startNode();
        node.typeAnnotation = this.flowParseTypeInitialiser();
        return this.finishNode(node, "TypeAnnotation");
      }

      flowParseTypeAnnotatableIdentifier(allowPrimitiveOverride?: boolean): Node {
        var ident = allowPrimitiveOverride ? this.parseIdentifier() : this.flowParseRestrictedIdentifier();

        if (this.match(types.colon)) {
          ident.typeAnnotation = this.flowParseTypeAnnotation();
          this.finishNode(ident, ident.type);
        }

        return ident;
      }

      typeCastToParameter(node: Node): Node {
        nodeValue(node.expression).typeAnnotation = node.typeAnnotation;
        return this.finishNodeAt(nodeValue(node.expression), nodeValue(node.expression).type, node.typeAnnotation!.end, node.typeAnnotation!.loc.end);
      }

      flowParseVariance(): Node | null {
        var variance = null;

        if (this.match(types.plusMin)) {
          variance = this.startNode();

          if (this.state.value === "+") {
            variance.kind = "plus";
          } else {
            variance.kind = "minus";
          }

          this.next();
          this.finishNode(variance, "Variance");
        }

        return variance;
      } // ==================================
      // Overrides
      // ==================================


      parseFunctionBody(node: Node, allowExpressionBody?: boolean): void {
        var _this2 = this;

        if (allowExpressionBody) {
          return this.forwardNoArrowParamsConversionAt(node, function () {
            return superClass.prototype.parseFunctionBody.call(_this2, node, true);
          });
        }

        return superClass.prototype.parseFunctionBody.call(this, node, false);
      }

      parseFunctionBodyAndFinish(node: Node, type: string | undefined, allowExpressionBody?: boolean): void {
        // For arrow functions, `parseArrow` handles the return type itself.
        if (!allowExpressionBody && this.match(types.colon)) {
          var typeNode = this.startNode();

          var _flowParseTypeAndPred2 = this.flowParseTypeAndPredicateInitialiser();

          // $FlowFixMe (destructuring not supported yet)
          typeNode.typeAnnotation = _flowParseTypeAndPred2[0];
          // $FlowFixMe (destructuring not supported yet)
          node.predicate = _flowParseTypeAndPred2[1];
          node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
        }

        superClass.prototype.parseFunctionBodyAndFinish.call(this, node, type, allowExpressionBody);
      } // interfaces


      parseStatement(declaration: boolean | undefined, topLevel?: boolean | undefined): Node {
        // strict mode handling of `interface` since it's a reserved word
        if (this.state.strict && this.match(types.name) && this.state.value === "interface") {
          var node = this.startNode();
          this.next();
          return this.flowParseInterface(node);
        } else {
          return superClass.prototype.parseStatement.call(this, declaration, topLevel);
        }
      } // declares, interfaces and type aliases


      parseExpressionStatement(node: Node, expr: Node): Node {
        if (expr.type === "Identifier") {
          if (expr.name === "declare") {
            if (this.match(types._class) || this.match(types.name) || this.match(types._function) || this.match(types._var) || this.match(types._export)) {
              return this.flowParseDeclare(node);
            }
          } else if (this.match(types.name)) {
            if (expr.name === "interface") {
              return this.flowParseInterface(node);
            } else if (expr.name === "type") {
              return this.flowParseTypeAlias(node);
            } else if (expr.name === "opaque") {
              return this.flowParseOpaqueType(node, false);
            }
          }
        }

        return superClass.prototype.parseExpressionStatement.call(this, node, expr);
      } // export type


      shouldParseExportDeclaration(): boolean {
        return this.isContextual("type") || this.isContextual("interface") || this.isContextual("opaque") || superClass.prototype.shouldParseExportDeclaration.call(this);
      }

      isExportDefaultSpecifier(): boolean {
        if (this.match(types.name) && (this.state.value === "type" || this.state.value === "interface" || this.state.value == "opaque")) {
          return false;
        }

        return superClass.prototype.isExportDefaultSpecifier.call(this);
      }

      parseConditional(expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position, refNeedsArrowPos?: StartReference): Node {
        var _this3 = this;

        if (!this.match(types.question)) return expr; // only do the expensive clone if there is a question mark
        // and if we come from inside parens

        if (refNeedsArrowPos) {
          var _state = this.state.clone();

          try {
            return superClass.prototype.parseConditional.call(this, expr, noIn, startPos, startLoc);
          } catch (err) {
            if (err instanceof SyntaxError) {
              this.state = _state;
              refNeedsArrowPos.start = ("pos" in err && typeof err.pos === "number" ? err.pos : 0) || this.state.start;
              return expr;
            } else {
              // istanbul ignore next: no such error is expected
              throw err;
            }
          }
        }

        this.expect(types.question);
        var state = this.state.clone();
        var originalNoArrowAt = this.state.noArrowAt;
        var node = this.startNodeAt(startPos!, startLoc);

        var _tryParseConditionalC = this.tryParseConditionalConsequent(),
            consequent = _tryParseConditionalC.consequent,
            failed = _tryParseConditionalC.failed;

        var _getArrowLikeExpressi = this.getArrowLikeExpressions(consequent),
            valid = _getArrowLikeExpressi[0],
            invalid = _getArrowLikeExpressi[1];

        if (failed || invalid.length > 0) {
          var noArrowAt = new Array<number>().concat(originalNoArrowAt);

          if (invalid.length > 0) {
            this.state = state;
            this.state.noArrowAt = noArrowAt;

            for (var i = 0; i < invalid.length; i++) {
              noArrowAt.push(invalid[i].start);
            }

            var _tryParseConditionalC2 = this.tryParseConditionalConsequent();

            consequent = _tryParseConditionalC2.consequent;
            failed = _tryParseConditionalC2.failed;

            var _getArrowLikeExpressi2 = this.getArrowLikeExpressions(consequent);

            valid = _getArrowLikeExpressi2[0];
            invalid = _getArrowLikeExpressi2[1];
          }

          if (failed && valid.length > 1) {
            // if there are two or more possible correct ways of parsing, throw an
            // error.
            // e.g.   Source: a ? (b): c => (d): e => f
            //      Result 1: a ? b : (c => ((d): e => f))
            //      Result 2: a ? ((b): c => d) : (e => f)
            this.raise(state.start, "Ambiguous expression: wrap the arrow functions in parentheses to disambiguate.");
          }

          if (failed && valid.length === 1) {
            this.state = state;
            this.state.noArrowAt = noArrowAt.concat(valid[0].start);

            var _tryParseConditionalC3 = this.tryParseConditionalConsequent();

            consequent = _tryParseConditionalC3.consequent;
            failed = _tryParseConditionalC3.failed;
          }

          this.getArrowLikeExpressions(consequent, true);
        }

        this.state.noArrowAt = originalNoArrowAt;
        this.expect(types.colon);
        node.test = expr;
        node.consequent = consequent;
        node.alternate = this.forwardNoArrowParamsConversionAt(node, function () {
          return _this3.parseMaybeAssign(noIn, undefined, undefined, undefined);
        });
        return this.finishNode(node, "ConditionalExpression");
      }

      tryParseConditionalConsequent(): { consequent: Node; failed: boolean; } {
        this.state.noArrowParamsConversionAt.push(this.state.start);
        var consequent = this.parseMaybeAssign();
        var failed = !this.match(types.colon);
        this.state.noArrowParamsConversionAt.pop();
        return {
          consequent,
          failed
        };
      } // Given an expression, walks throught its arrow functions whose body is
      // an expression and throught conditional expressions. It returns every
      // function which has been parsed with a return type but could have been
      // parenthesized expressions.
      // These functions are separated into two arrays: one containing the ones
      // whose parameters can be converted to assignable lists, one containing the
      // others.


      getArrowLikeExpressions(node: Node, disallowInvalid?: boolean): [Node[], Node[]] {
        var _this4 = this;

        var stack = [node];
        var arrows: Node[] = [];

        while (stack.length !== 0) {
          var _node = stack.pop()!;

          if (_node.type === "ArrowFunctionExpression") {
            if (_node.typeParameters || !_node.returnType) {
              // This is an arrow expression without ambiguity, so check its parameters
              this.toAssignableList( // node.params is Expression[] instead of $ReadOnlyArray<Pattern> because it
              // has not been converted yet.
              _node.params, true, "arrow function parameters"); // Use super's method to force the parameters to be checked

              superClass.prototype.checkFunctionNameAndParams.call(this, _node, true);
            } else {
              arrows.push(_node);
            }

            stack.push(nodeValue(_node.body));
          } else if (_node.type === "ConditionalExpression") {
            stack.push(nodeValue(_node.consequent));
            stack.push(nodeValue(_node.alternate));
          }
        }

        if (disallowInvalid) {
          for (var i = 0; i < arrows.length; i++) {
            this.toAssignableList(node.params, true, "arrow function parameters");
          }

          return [arrows, []];
        }

        return partition(arrows, function (node) {
          try {
            _this4.toAssignableList(node.params, true, "arrow function parameters");

            return true;
          } catch (err) {
            return false;
          }
        });
      }

      forwardNoArrowParamsConversionAt<T>(node: Node, parse: () => T): T {
        var result;

        if (this.state.noArrowParamsConversionAt.indexOf(node.start) !== -1) {
          this.state.noArrowParamsConversionAt.push(this.state.start);
          result = parse();
          this.state.noArrowParamsConversionAt.pop();
        } else {
          result = parse();
        }

        return result;
      }

      parseParenItem(node: Node, startPos?: number, startLoc?: Position): Node {
        node = superClass.prototype.parseParenItem.call(this, node, startPos, startLoc);

        if (this.eat(types.question)) {
          node.optional = true;
        }

        if (this.match(types.colon)) {
          var typeCastNode = this.startNodeAt(startPos!, startLoc);
          typeCastNode.expression = node;
          typeCastNode.typeAnnotation = this.flowParseTypeAnnotation();
          return this.finishNode(typeCastNode, "TypeCastExpression");
        }

        return node;
      }

      assertModuleNodeAllowed(node: Node): void {
        if (node.type === "ImportDeclaration" && (node.importKind === "type" || node.importKind === "typeof") || node.type === "ExportNamedDeclaration" && node.exportKind === "type" || node.type === "ExportAllDeclaration" && node.exportKind === "type") {
          // Allow Flowtype imports and exports in all conditions because
          // Flow itself does not care about 'sourceType'.
          return;
        }

        superClass.prototype.assertModuleNodeAllowed.call(this, node);
      }

      parseExport(node: Node): Node {
        node = superClass.prototype.parseExport.call(this, node);

        if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
          node.exportKind = node.exportKind || "value";
        }

        return node;
      }

      parseExportDeclaration(node?: Node): Node | null {
        if (this.isContextual("type")) {
          node!.exportKind = "type";
          var declarationNode = this.startNode();
          this.next();

          if (this.match(types.braceL)) {
            // export type { foo, bar };
            node!.specifiers = this.parseExportSpecifiers();
            this.parseExportFrom(node!);
            return null;
          } else {
            // export type Foo = Bar;
            return this.flowParseTypeAlias(declarationNode);
          }
        } else if (this.isContextual("opaque")) {
          node!.exportKind = "type";

          var _declarationNode = this.startNode();

          this.next(); // export opaque type Foo = Bar;

          return this.flowParseOpaqueType(_declarationNode, false);
        } else if (this.isContextual("interface")) {
          node!.exportKind = "type";

          var _declarationNode2 = this.startNode();

          this.next();
          return this.flowParseInterface(_declarationNode2);
        } else {
          return superClass.prototype.parseExportDeclaration.call(this, node);
        }
      }

      shouldParseExportStar(): boolean {
        return superClass.prototype.shouldParseExportStar.call(this) || this.isContextual("type") && this.lookahead().type === types.star;
      }

      parseExportStar(node: Node, allowNamed?: boolean): void {
        if (this.eatContextual("type")) {
          node.exportKind = "type";
          allowNamed = false;
        }

        return superClass.prototype.parseExportStar.call(this, node, allowNamed);
      }

      parseClassId(node: Node, isStatement: boolean | number, optionalId: boolean | undefined): void {
        superClass.prototype.parseClassId.call(this, node, isStatement, optionalId);

        if (this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
        }
      } // don't consider `void` to be a keyword as then it'll use the void token type
      // and set startExpr


      isKeyword(name: string): boolean {
        if (this.state.inType && name === "void") {
          return false;
        } else {
          return superClass.prototype.isKeyword.call(this, name);
        }
      } // ensure that inside flow types, we bypass the jsx parser plugin


      readToken(code: number): void {
        if (this.state.inType && (code === 62 || code === 60)) {
          return this.finishOp(types.relational, 1);
        } else {
          return superClass.prototype.readToken.call(this, code);
        }
      }

      toAssignable(node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null {
        if (node!.type === "TypeCastExpression") {
          return superClass.prototype.toAssignable.call(this, this.typeCastToParameter(node!), isBinding, contextDescription);
        } else {
          return superClass.prototype.toAssignable.call(this, node, isBinding, contextDescription);
        }
      } // turn type casts that we found in function parameter head into type annotated params


      toAssignableList(exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[] {
        for (var i = 0; i < exprList.length; i++) {
          var expr = exprList[i];

          if (expr && expr.type === "TypeCastExpression") {
            exprList[i] = this.typeCastToParameter(expr);
          }
        }

        return superClass.prototype.toAssignableList.call(this, exprList, isBinding, contextDescription);
      } // this is a list of nodes, from something like a call expression, we need to filter the
      // type casts that we've found that are illegal in this context


      toReferencedList(exprList: (Node | null)[]): (Node | null)[] {
        for (var i = 0; i < exprList.length; i++) {
          var expr = exprList[i];

          if (expr && expr._exprListItem && expr.type === "TypeCastExpression") {
            this.raise(expr.start, "Unexpected type cast");
          }
        }

        return exprList;
      } // parse an item inside a expression list eg. `(NODE, NODE)` where NODE represents
      // the position where this function is called


      parseExprListItem(allowEmpty: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos?: StartReference | undefined): Node | null {
        var container = this.startNode();

        var node = superClass.prototype.parseExprListItem.call(this, allowEmpty, refShorthandDefaultPos, refNeedsArrowPos);

        if (this.match(types.colon)) {
          container._exprListItem = true;
          container.expression = node;
          container.typeAnnotation = this.flowParseTypeAnnotation();
          return this.finishNode(container, "TypeCastExpression");
        } else {
          return node;
        }
      }

      checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void {
        if (expr.type !== "TypeCastExpression") {
          return superClass.prototype.checkLVal.call(this, expr, isBinding, checkClashes, contextDescription);
        }
      } // parse class property type annotations


      parseClassProperty(node: Node): Node {
        if (this.match(types.colon)) {
          node.typeAnnotation = this.flowParseTypeAnnotation();
        }

        return superClass.prototype.parseClassProperty.call(this, node);
      } // determine whether or not we're currently in the position where a class method would appear


      isClassMethod(): boolean {
        return this.isRelational("<") || superClass.prototype.isClassMethod.call(this);
      } // determine whether or not we're currently in the position where a class property would appear


      isClassProperty(): boolean {
        return this.match(types.colon) || superClass.prototype.isClassProperty.call(this);
      }

      isNonstaticConstructor(method: Node): boolean {
        return !this.match(types.colon) && superClass.prototype.isNonstaticConstructor.call(this, method);
      } // parse type parameters for class methods


      pushClassMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean): void {
        if (method.variance) {
          this.unexpected(method.variance.start);
        }

        removeField(method, "variance");

        if (this.isRelational("<")) {
          method.typeParameters = this.flowParseTypeParameterDeclaration();
        }

        superClass.prototype.pushClassMethod.call(this, classBody, method, isGenerator, isAsync, isConstructor);
      }

      pushClassPrivateMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined): void {
        if (method.variance) {
          this.unexpected(method.variance.start);
        }

        removeField(method, "variance");

        if (this.isRelational("<")) {
          method.typeParameters = this.flowParseTypeParameterDeclaration();
        }

        superClass.prototype.pushClassPrivateMethod.call(this, classBody, method, isGenerator, isAsync);
      } // parse a the super class type parameters and implements


      parseClassSuper(node: Node): void {
        superClass.prototype.parseClassSuper.call(this, node);

        if (node.superClass && this.isRelational("<")) {
          node.superTypeParameters = this.flowParseTypeParameterInstantiation();
        }

        if (this.isContextual("implements")) {
          this.next();
          var implemented: Node[] = node.implements = [];

          do {
            var _node2 = this.startNode();

            _node2.id = this.parseIdentifier();

            if (this.isRelational("<")) {
              _node2.typeParameters = this.flowParseTypeParameterInstantiation();
            } else {
              _node2.typeParameters = null;
            }

            implemented.push(this.finishNode(_node2, "ClassImplements"));
          } while (this.eat(types.comma));
        }
      }

      parsePropertyName(node: Node): Node {
        var variance = this.flowParseVariance();

        var key = superClass.prototype.parsePropertyName.call(this, node); // $FlowIgnore ("variance" not defined on TsNamedTypeElementBase)


        node.variance = variance;
        return key;
      } // parse type parameters for object method shorthand


      parseObjPropValue(prop: Node, startPos: number | undefined, startLoc: Position | undefined, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference): Node | void {
        if (prop.variance) {
          this.unexpected(prop.variance.start);
        }

        removeField(prop, "variance");
        var typeParameters; // method shorthand

        if (this.isRelational("<")) {
          typeParameters = this.flowParseTypeParameterDeclaration();
          if (!this.match(types.parenL)) this.unexpected();
        }

        superClass.prototype.parseObjPropValue.call(this, prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos); // add typeParameters if we found them


        if (typeParameters) {
          // $FlowFixMe (trying to set '.typeParameters' on an expression)
          nodeValue(prop.value || prop).typeParameters = typeParameters;
        }
      }

      parseAssignableListItemTypes(param: Node): Node {
        if (this.eat(types.question)) {
          if (param.type !== "Identifier") {
            throw this.raise(param.start, "A binding pattern parameter cannot be optional in an implementation signature.");
          }

          param.optional = true;
        }

        if (this.match(types.colon)) {
          param.typeAnnotation = this.flowParseTypeAnnotation();
        }

        this.finishNode(param, param.type);
        return param;
      }

      parseMaybeDefault(startPos?: number, startLoc?: Position | null | undefined, left?: Node): Node {
        var node = superClass.prototype.parseMaybeDefault.call(this, startPos, startLoc, left);

        if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
          this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`");
        }

        return node;
      }

      shouldParseDefaultImport(node: Node): boolean {
        if (!hasTypeImportKind(node)) {
          return superClass.prototype.shouldParseDefaultImport.call(this, node);
        }

        return isMaybeDefaultImport(this.state);
      }

      parseImportSpecifierLocal(node: Node, specifier: Node, type: string, contextDescription: string): void {
        specifier.local = hasTypeImportKind(node) ? this.flowParseRestrictedIdentifier(true) : this.parseIdentifier();
        this.checkLVal(specifier.local, true, undefined, contextDescription);
        node.specifiers.push(this.finishNode(specifier, type));
      } // parse typeof and type imports


      parseImportSpecifiers(node: Node): void {
        node.importKind = "value";
        var kind: string | null = null;

        if (this.match(types._typeof)) {
          kind = "typeof";
        } else if (this.isContextual("type")) {
          kind = "type";
        }

        if (kind) {
          var lh = this.lookahead();

          if (isMaybeDefaultImport(lh) || lh.type === types.braceL || lh.type === types.star) {
            this.next();
            node.importKind = kind;
          }
        }

        superClass.prototype.parseImportSpecifiers.call(this, node);
      } // parse import-type/typeof shorthand


      parseImportSpecifier(node: Node): void {
        var specifier = this.startNode();
        var firstIdentLoc = this.state.start;
        var firstIdent = this.parseIdentifier(true);
        var specifierTypeKind = null;

        if (firstIdent.name === "type") {
          specifierTypeKind = "type";
        } else if (firstIdent.name === "typeof") {
          specifierTypeKind = "typeof";
        }

        var isBinding = false;

        if (this.isContextual("as") && !this.isLookaheadContextual("as")) {
          var as_ident = this.parseIdentifier(true);

          if (specifierTypeKind !== null && !this.match(types.name) && !this.state.type.keyword) {
            // `import {type as ,` or `import {type as }`
            specifier.imported = as_ident;
            specifier.importKind = specifierTypeKind;
            specifier.local = as_ident.__clone();
          } else {
            // `import {type as foo`
            specifier.imported = firstIdent;
            specifier.importKind = null;
            specifier.local = this.parseIdentifier();
          }
        } else if (specifierTypeKind !== null && (this.match(types.name) || this.state.type.keyword)) {
          // `import {type foo`
          specifier.imported = this.parseIdentifier(true);
          specifier.importKind = specifierTypeKind;

          if (this.eatContextual("as")) {
            specifier.local = this.parseIdentifier();
          } else {
            isBinding = true;
            specifier.local = specifier.imported.__clone();
          }
        } else {
          isBinding = true;
          specifier.imported = firstIdent;
          specifier.importKind = null;
          specifier.local = specifier.imported.__clone();
        }

        var nodeIsTypeImport = hasTypeImportKind(node);
        var specifierIsTypeImport = hasTypeImportKind(specifier);

        if (nodeIsTypeImport && specifierIsTypeImport) {
          this.raise(firstIdentLoc, "The `type` and `typeof` keywords on named imports can only be used on regular `import` statements. It cannot be used with `import type` or `import typeof` statements");
        }

        if (nodeIsTypeImport || specifierIsTypeImport) {
          this.checkReservedType(stringValue(specifier.local.name), specifier.local.start);
        }

        if (isBinding && !nodeIsTypeImport && !specifierIsTypeImport) {
          this.checkReservedWord(specifier.local.name!, specifier.start, true, true);
        }

        this.checkLVal(specifier.local, true, undefined, "import specifier");
        node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
      } // parse function type parameters - function foo<T>() {}


      parseFunctionParams(node: Node, allowModifiers?: boolean): void {
        // $FlowFixMe
        var kind = node.kind;

        if (kind !== "get" && kind !== "set" && this.isRelational("<")) {
          node.typeParameters = this.flowParseTypeParameterDeclaration();
        }

        superClass.prototype.parseFunctionParams.call(this, node);
      } // parse flow type annotations on variable declarator heads - let foo: string = bar


      parseVarHead(decl: Node): void {
        superClass.prototype.parseVarHead.call(this, decl);

        if (this.match(types.colon)) {
          decl.id!.typeAnnotation = this.flowParseTypeAnnotation();
          this.finishNode(decl.id!, decl.id!.type);
        }
      } // parse the return type of an async arrow function - let foo = (async (): number => {});


      parseAsyncArrowFromCallExpression(node: Node, call: Node): Node {
        if (this.match(types.colon)) {
          var oldNoAnonFunctionType = this.state.noAnonFunctionType;
          this.state.noAnonFunctionType = true;
          node.returnType = this.flowParseTypeAnnotation();
          this.state.noAnonFunctionType = oldNoAnonFunctionType;
        }

        return superClass.prototype.parseAsyncArrowFromCallExpression.call(this, node, call);
      } // todo description


      shouldParseAsyncArrow(): boolean {
        return this.match(types.colon) || superClass.prototype.shouldParseAsyncArrow.call(this);
      } // We need to support type parameter declarations for arrow functions. This
      // is tricky. There are three situations we need to handle
      //
      // 1. This is either JSX or an arrow function. We'll try JSX first. If that
      //    fails, we'll try an arrow function. If that fails, we'll throw the JSX
      //    error.
      // 2. This is an arrow function. We'll parse the type parameter declaration,
      //    parse the rest, make sure the rest is an arrow function, and go from
      //    there
      // 3. This is neither. Just call the super method


      parseMaybeAssign(noIn?: boolean, refShorthandDefaultPos?: StartReference, afterLeftParse?: (this: BaseParser, node: Node, startPos: number, startLoc: Position) => Node, refNeedsArrowPos?: StartReference): Node {
        var _this5 = this;

        var jsxError = null;

        if (types.jsxTagStart && this.match(types.jsxTagStart)) {
          var state = this.state.clone();

          try {
            return superClass.prototype.parseMaybeAssign.call(this, noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
          } catch (err) {
            if (err instanceof SyntaxError) {
              this.state = state; // Remove `tc.j_expr` and `tc.j_oTag` from context added
              // by parsing `jsxTagStart` to stop the JSX plugin from
              // messing with the tokens

              this.state.context.length -= 2;
              jsxError = err;
            } else {
              // istanbul ignore next: no such error is expected
              throw err;
            }
          }
        }

        if (jsxError != null || this.isRelational("<")) {
          var arrowExpression;
          var typeParameters;

          try {
            typeParameters = this.flowParseTypeParameterDeclaration();
            arrowExpression = this.forwardNoArrowParamsConversionAt(typeParameters, function () {
              return superClass.prototype.parseMaybeAssign.call(_this5, noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
            });
            arrowExpression.typeParameters = typeParameters;
            this.resetStartLocationFromNode(arrowExpression, typeParameters);
          } catch (err) {
            throw jsxError || err;
          }

          if (arrowExpression.type === "ArrowFunctionExpression") {
            return arrowExpression;
          } else if (jsxError != null) {
            throw jsxError;
          } else {
            this.raise(typeParameters.start, "Expected an arrow function after this type parameter declaration");
          }
        }

        return superClass.prototype.parseMaybeAssign.call(this, noIn, refShorthandDefaultPos, afterLeftParse, refNeedsArrowPos);
      } // handle return types for arrow functions


      parseArrow(node: Node): Node | undefined {
        if (this.match(types.colon)) {
          var state = this.state.clone();

          try {
            var oldNoAnonFunctionType = this.state.noAnonFunctionType;
            this.state.noAnonFunctionType = true;
            var typeNode = this.startNode();

            var _flowParseTypeAndPred3 = this.flowParseTypeAndPredicateInitialiser();

            // $FlowFixMe (destructuring not supported yet)
            typeNode.typeAnnotation = _flowParseTypeAndPred3[0];
            // $FlowFixMe (destructuring not supported yet)
            node.predicate = _flowParseTypeAndPred3[1];
            this.state.noAnonFunctionType = oldNoAnonFunctionType;
            if (this.canInsertSemicolon()) this.unexpected();
            if (!this.match(types.arrow)) this.unexpected(); // assign after it is clear it is an arrow

            node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
          } catch (err) {
            if (err instanceof SyntaxError) {
              this.state = state;
            } else {
              // istanbul ignore next: no such error is expected
              throw err;
            }
          }
        }

        return superClass.prototype.parseArrow.call(this, node);
      }

      shouldParseArrow(): boolean {
        return this.match(types.colon) || superClass.prototype.shouldParseArrow.call(this);
      }

      setArrowFunctionParameters(node: Node, params: (Node | null)[]): void {
        if (this.state.noArrowParamsConversionAt.indexOf(node.start) !== -1) {
          node.params = params;
        } else {
          superClass.prototype.setArrowFunctionParameters.call(this, node, params);
        }
      }

      checkFunctionNameAndParams(node: Node, isArrowFunction?: boolean): void {
        if (isArrowFunction && this.state.noArrowParamsConversionAt.indexOf(node.start) !== -1) {
          return;
        }

        return superClass.prototype.checkFunctionNameAndParams.call(this, node, isArrowFunction);
      }

      parseParenAndDistinguishExpression(canBeArrow: boolean | undefined): Node {
        return superClass.prototype.parseParenAndDistinguishExpression.call(this, canBeArrow && this.state.noArrowAt.indexOf(this.state.start) === -1);
      }

      parseSubscripts(base: Node, startPos: number, startLoc: Position, noCalls?: boolean): Node {
        if (base.type === "Identifier" && base.name === "async" && this.state.noArrowAt.indexOf(startPos) !== -1) {
          this.next();
          var node = this.startNodeAt(startPos!, startLoc);
          node.callee = base;
          node.arguments = this.parseCallExpressionArguments(types.parenR, false);
          base = this.finishNode(node, "CallExpression");
        }

        return superClass.prototype.parseSubscripts.call(this, base, startPos, startLoc, noCalls);
      }

      
}
  );
});

var entities: Record<string, string> = {
  quot: "\u0022",
  amp: "&",
  apos: "\u0027",
  lt: "<",
  gt: ">",
  nbsp: "\u00A0",
  iexcl: "\u00A1",
  cent: "\u00A2",
  pound: "\u00A3",
  curren: "\u00A4",
  yen: "\u00A5",
  brvbar: "\u00A6",
  sect: "\u00A7",
  uml: "\u00A8",
  copy: "\u00A9",
  ordf: "\u00AA",
  laquo: "\u00AB",
  not: "\u00AC",
  shy: "\u00AD",
  reg: "\u00AE",
  macr: "\u00AF",
  deg: "\u00B0",
  plusmn: "\u00B1",
  sup2: "\u00B2",
  sup3: "\u00B3",
  acute: "\u00B4",
  micro: "\u00B5",
  para: "\u00B6",
  middot: "\u00B7",
  cedil: "\u00B8",
  sup1: "\u00B9",
  ordm: "\u00BA",
  raquo: "\u00BB",
  frac14: "\u00BC",
  frac12: "\u00BD",
  frac34: "\u00BE",
  iquest: "\u00BF",
  Agrave: "\u00C0",
  Aacute: "\u00C1",
  Acirc: "\u00C2",
  Atilde: "\u00C3",
  Auml: "\u00C4",
  Aring: "\u00C5",
  AElig: "\u00C6",
  Ccedil: "\u00C7",
  Egrave: "\u00C8",
  Eacute: "\u00C9",
  Ecirc: "\u00CA",
  Euml: "\u00CB",
  Igrave: "\u00CC",
  Iacute: "\u00CD",
  Icirc: "\u00CE",
  Iuml: "\u00CF",
  ETH: "\u00D0",
  Ntilde: "\u00D1",
  Ograve: "\u00D2",
  Oacute: "\u00D3",
  Ocirc: "\u00D4",
  Otilde: "\u00D5",
  Ouml: "\u00D6",
  times: "\u00D7",
  Oslash: "\u00D8",
  Ugrave: "\u00D9",
  Uacute: "\u00DA",
  Ucirc: "\u00DB",
  Uuml: "\u00DC",
  Yacute: "\u00DD",
  THORN: "\u00DE",
  szlig: "\u00DF",
  agrave: "\u00E0",
  aacute: "\u00E1",
  acirc: "\u00E2",
  atilde: "\u00E3",
  auml: "\u00E4",
  aring: "\u00E5",
  aelig: "\u00E6",
  ccedil: "\u00E7",
  egrave: "\u00E8",
  eacute: "\u00E9",
  ecirc: "\u00EA",
  euml: "\u00EB",
  igrave: "\u00EC",
  iacute: "\u00ED",
  icirc: "\u00EE",
  iuml: "\u00EF",
  eth: "\u00F0",
  ntilde: "\u00F1",
  ograve: "\u00F2",
  oacute: "\u00F3",
  ocirc: "\u00F4",
  otilde: "\u00F5",
  ouml: "\u00F6",
  divide: "\u00F7",
  oslash: "\u00F8",
  ugrave: "\u00F9",
  uacute: "\u00FA",
  ucirc: "\u00FB",
  uuml: "\u00FC",
  yacute: "\u00FD",
  thorn: "\u00FE",
  yuml: "\u00FF",
  OElig: "\u0152",
  oelig: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Yuml: "\u0178",
  fnof: "\u0192",
  circ: "\u02C6",
  tilde: "\u02DC",
  Alpha: "\u0391",
  Beta: "\u0392",
  Gamma: "\u0393",
  Delta: "\u0394",
  Epsilon: "\u0395",
  Zeta: "\u0396",
  Eta: "\u0397",
  Theta: "\u0398",
  Iota: "\u0399",
  Kappa: "\u039A",
  Lambda: "\u039B",
  Mu: "\u039C",
  Nu: "\u039D",
  Xi: "\u039E",
  Omicron: "\u039F",
  Pi: "\u03A0",
  Rho: "\u03A1",
  Sigma: "\u03A3",
  Tau: "\u03A4",
  Upsilon: "\u03A5",
  Phi: "\u03A6",
  Chi: "\u03A7",
  Psi: "\u03A8",
  Omega: "\u03A9",
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  epsilon: "\u03B5",
  zeta: "\u03B6",
  eta: "\u03B7",
  theta: "\u03B8",
  iota: "\u03B9",
  kappa: "\u03BA",
  lambda: "\u03BB",
  mu: "\u03BC",
  nu: "\u03BD",
  xi: "\u03BE",
  omicron: "\u03BF",
  pi: "\u03C0",
  rho: "\u03C1",
  sigmaf: "\u03C2",
  sigma: "\u03C3",
  tau: "\u03C4",
  upsilon: "\u03C5",
  phi: "\u03C6",
  chi: "\u03C7",
  psi: "\u03C8",
  omega: "\u03C9",
  thetasym: "\u03D1",
  upsih: "\u03D2",
  piv: "\u03D6",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201A",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bdquo: "\u201E",
  dagger: "\u2020",
  Dagger: "\u2021",
  bull: "\u2022",
  hellip: "\u2026",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  lsaquo: "\u2039",
  rsaquo: "\u203A",
  oline: "\u203E",
  frasl: "\u2044",
  euro: "\u20AC",
  image: "\u2111",
  weierp: "\u2118",
  real: "\u211C",
  trade: "\u2122",
  alefsym: "\u2135",
  larr: "\u2190",
  uarr: "\u2191",
  rarr: "\u2192",
  darr: "\u2193",
  harr: "\u2194",
  crarr: "\u21B5",
  lArr: "\u21D0",
  uArr: "\u21D1",
  rArr: "\u21D2",
  dArr: "\u21D3",
  hArr: "\u21D4",
  forall: "\u2200",
  part: "\u2202",
  exist: "\u2203",
  empty: "\u2205",
  nabla: "\u2207",
  isin: "\u2208",
  notin: "\u2209",
  ni: "\u220B",
  prod: "\u220F",
  sum: "\u2211",
  minus: "\u2212",
  lowast: "\u2217",
  radic: "\u221A",
  prop: "\u221D",
  infin: "\u221E",
  ang: "\u2220",
  and: "\u2227",
  or: "\u2228",
  cap: "\u2229",
  cup: "\u222A",
  int: "\u222B",
  there4: "\u2234",
  sim: "\u223C",
  cong: "\u2245",
  asymp: "\u2248",
  ne: "\u2260",
  equiv: "\u2261",
  le: "\u2264",
  ge: "\u2265",
  sub: "\u2282",
  sup: "\u2283",
  nsub: "\u2284",
  sube: "\u2286",
  supe: "\u2287",
  oplus: "\u2295",
  otimes: "\u2297",
  perp: "\u22A5",
  sdot: "\u22C5",
  lceil: "\u2308",
  rceil: "\u2309",
  lfloor: "\u230A",
  rfloor: "\u230B",
  lang: "\u2329",
  rang: "\u232A",
  loz: "\u25CA",
  spades: "\u2660",
  clubs: "\u2663",
  hearts: "\u2665",
  diams: "\u2666"
};

var HEX_NUMBER = /^[\da-fA-F]+$/;
var DECIMAL_NUMBER = /^\d+$/;
types$1.j_oTag = new TokContext("<tag", false);
types$1.j_cTag = new TokContext("</tag", false);
types$1.j_expr = new TokContext("<tag>...</tag>", true, true);
types.jsxName = new TokenType("jsxName");
types.jsxText = new TokenType("jsxText", {
  beforeExpr: true
});
types.jsxTagStart = new TokenType("jsxTagStart", {
  startsExpr: true
});
types.jsxTagEnd = new TokenType("jsxTagEnd");

types.jsxTagStart.updateContext = function () {
  this.state.context.push(types$1.j_expr); // treat as beginning of JSX expression

  this.state.context.push(types$1.j_oTag); // start opening tag context

  this.state.exprAllowed = false;
};

types.jsxTagEnd.updateContext = function (prevType) {
  var out = this.state.context.pop();

  if (out === types$1.j_oTag && prevType === types.slash || out === types$1.j_cTag) {
    this.state.context.pop();
    this.state.exprAllowed = this.curContext() === types$1.j_expr;
  } else {
    this.state.exprAllowed = true;
  }
};

function isFragment(object: Node): boolean {
  return object ? object.type === "JSXOpeningFragment" || object.type === "JSXClosingFragment" : false;
} // Transforms JSX element name to string.


function getQualifiedJSXName(object: Node): string {
  if (object.type === "JSXIdentifier") {
    return stringValue(object.name);
  }

  if (object.type === "JSXNamespacedName") {
    return object.namespace.name + ":" + nodeValue(object.name).name;
  }

  if (object.type === "JSXMemberExpression") {
    return getQualifiedJSXName(object.object!) + "." + getQualifiedJSXName(object.property);
  } // istanbul ignore next


  throw new Error("Node had unexpected type: " + object.type);
}

var jsxPlugin = (function (superClass: typeof Parser) {
  return (
    /*#__PURE__*/
    class _class extends superClass {
      

      

      

      // Reads inline JSX contents token.
      jsxReadToken(): void {
        var out = "";
        var chunkStart = this.state.pos;

        for (;;) {
          if (this.state.pos >= this.input.length) {
            this.raise(this.state.start, "Unterminated JSX contents");
          }

          var ch = this.input.charCodeAt(this.state.pos);

          switch (ch) {
            case 60: // "<"

            case 123:
              // "{"
              if (this.state.pos === this.state.start) {
                if (ch === 60 && this.state.exprAllowed) {
                  ++this.state.pos;
                  return this.finishToken(types.jsxTagStart);
                }

                return this.getTokenFromCode(ch);
              }

              out += this.input.slice(chunkStart, this.state.pos);
              return this.finishToken(types.jsxText, out);

            case 38:
              // "&"
              out += this.input.slice(chunkStart, this.state.pos);
              out += this.jsxReadEntity();
              chunkStart = this.state.pos;
              break;

            default:
              if (isNewLine(ch)) {
                out += this.input.slice(chunkStart, this.state.pos);
                out += this.jsxReadNewLine(true);
                chunkStart = this.state.pos;
              } else {
                ++this.state.pos;
              }

          }
        }
      }

      jsxReadNewLine(normalizeCRLF: boolean | undefined): string {
        var ch = this.input.charCodeAt(this.state.pos);
        var out;
        ++this.state.pos;

        if (ch === 13 && this.input.charCodeAt(this.state.pos) === 10) {
          ++this.state.pos;
          out = normalizeCRLF ? "\n" : "\r\n";
        } else {
          out = String.fromCharCode(ch);
        }

        ++this.state.curLine;
        this.state.lineStart = this.state.pos;
        return out;
      }

      jsxReadString(quote: number): void {
        var out = "";
        var chunkStart = ++this.state.pos;

        for (;;) {
          if (this.state.pos >= this.input.length) {
            this.raise(this.state.start, "Unterminated string constant");
          }

          var ch = this.input.charCodeAt(this.state.pos);
          if (ch === quote) break;

          if (ch === 38) {
            // "&"
            out += this.input.slice(chunkStart, this.state.pos);
            out += this.jsxReadEntity();
            chunkStart = this.state.pos;
          } else if (isNewLine(ch)) {
            out += this.input.slice(chunkStart, this.state.pos);
            out += this.jsxReadNewLine(false);
            chunkStart = this.state.pos;
          } else {
            ++this.state.pos;
          }
        }

        out += this.input.slice(chunkStart, this.state.pos++);
        return this.finishToken(types.string, out);
      }

      jsxReadEntity(): string {
        var str = "";
        var count = 0;
        var entity;
        var ch = this.input[this.state.pos];
        var startPos = ++this.state.pos;

        while (this.state.pos < this.input.length && count++ < 10) {
          ch = this.input[this.state.pos++];

          if (ch === ";") {
            if (str[0] === "#") {
              if (str[1] === "x") {
                str = str.substr(2);

                if (HEX_NUMBER.test(str)) {
                  entity = String.fromCodePoint(parseInt(str, 16));
                }
              } else {
                str = str.substr(1);

                if (DECIMAL_NUMBER.test(str)) {
                  entity = String.fromCodePoint(parseInt(str, 10));
                }
              }
            } else {
              entity = entities[str];
            }

            break;
          }

          str += ch;
        }

        if (!entity) {
          this.state.pos = startPos;
          return "&";
        }

        return entity;
      } // Read a JSX identifier (valid tag or attribute name).
      //
      // Optimized version since JSX identifiers can"t contain
      // escape characters and so can be read as single slice.
      // Also assumes that first character was already checked
      // by isIdentifierStart in readToken.


      jsxReadWord(): void {
        var ch;
        var start = this.state.pos;

        do {
          ch = this.input.charCodeAt(++this.state.pos);
        } while (isIdentifierChar(ch) || ch === 45); // "-"


        return this.finishToken(types.jsxName, this.input.slice(start, this.state.pos));
      } // Parse next token as JSX identifier


      jsxParseIdentifier(): Node {
        var node = this.startNode();

        if (this.match(types.jsxName)) {
          node.name = stringValue(this.state.value);
        } else if (this.state.type.keyword) {
          node.name = this.state.type.keyword;
        } else {
          this.unexpected();
        }

        this.next();
        return this.finishNode(node, "JSXIdentifier");
      } // Parse namespaced identifier.


      jsxParseNamespacedName(): Node {
        var startPos = this.state.start;
        var startLoc = this.state.startLoc;
        var name = this.jsxParseIdentifier();
        if (!this.eat(types.colon)) return name;
        var node = this.startNodeAt(startPos!, startLoc);
        node.namespace = name;
        node.name = this.jsxParseIdentifier();
        return this.finishNode(node, "JSXNamespacedName");
      } // Parses element name in any form - namespaced, member
      // or single identifier.


      jsxParseElementName(): Node {
        var startPos = this.state.start;
        var startLoc = this.state.startLoc;
        var node = this.jsxParseNamespacedName();

        while (this.eat(types.dot)) {
          var newNode = this.startNodeAt(startPos!, startLoc);
          newNode.object = node;
          newNode.property = this.jsxParseIdentifier();
          node = this.finishNode(newNode, "JSXMemberExpression");
        }

        return node;
      } // Parses any type of JSX attribute value.


      jsxParseAttributeValue(): Node {
        var node;

        switch (this.state.type) {
          case types.braceL:
            node = this.jsxParseExpressionContainer();

            if (nodeValue(node.expression).type === "JSXEmptyExpression") {
              throw this.raise(node.start, "JSX attributes must only be assigned a non-empty expression");
            } else {
              return node;
            }

          case types.jsxTagStart:
          case types.string:
            return this.parseExprAtom();

          default:
            throw this.raise(this.state.start, "JSX value should be either an expression or a quoted JSX text");
        }
      } // JSXEmptyExpression is unique type since it doesn't actually parse anything,
      // and so it should start at the end of last read token (left brace) and finish
      // at the beginning of the next one (right brace).


      jsxParseEmptyExpression(): Node {
        var node = this.startNodeAt(this.state.lastTokEnd, this.state.lastTokEndLoc);
        return this.finishNodeAt(node, "JSXEmptyExpression", this.state.start, this.state.startLoc);
      } // Parse JSX spread child


      jsxParseSpreadChild(): Node {
        var node = this.startNode();
        this.expect(types.braceL);
        this.expect(types.ellipsis);
        node.expression = this.parseExpression();
        this.expect(types.braceR);
        return this.finishNode(node, "JSXSpreadChild");
      } // Parses JSX expression enclosed into curly brackets.


      jsxParseExpressionContainer(): Node {
        var node = this.startNode();
        this.next();

        if (this.match(types.braceR)) {
          node.expression = this.jsxParseEmptyExpression();
        } else {
          node.expression = this.parseExpression();
        }

        this.expect(types.braceR);
        return this.finishNode(node, "JSXExpressionContainer");
      } // Parses following JSX attribute name-value pair.


      jsxParseAttribute(): Node {
        var node = this.startNode();

        if (this.eat(types.braceL)) {
          this.expect(types.ellipsis);
          node.argument = this.parseMaybeAssign();
          this.expect(types.braceR);
          return this.finishNode(node, "JSXSpreadAttribute");
        }

        node.name = this.jsxParseNamespacedName();
        node.value = this.eat(types.eq) ? this.jsxParseAttributeValue() : null;
        return this.finishNode(node, "JSXAttribute");
      } // Parses JSX opening tag starting after "<".


      jsxParseOpeningElementAt(startPos: number, startLoc: Position): Node {
        var node = this.startNodeAt(startPos!, startLoc);

        if (this.match(types.jsxTagEnd)) {
          this.expect(types.jsxTagEnd);
          return this.finishNode(node, "JSXOpeningFragment");
        }

        node.attributes = [];
        node.name = this.jsxParseElementName();

        while (!this.match(types.slash) && !this.match(types.jsxTagEnd)) {
          node.attributes.push(this.jsxParseAttribute());
        }

        node.selfClosing = this.eat(types.slash);
        this.expect(types.jsxTagEnd);
        return this.finishNode(node, "JSXOpeningElement");
      } // Parses JSX closing tag starting after "</".


      jsxParseClosingElementAt(startPos: number, startLoc: Position): Node {
        var node = this.startNodeAt(startPos!, startLoc);

        if (this.match(types.jsxTagEnd)) {
          this.expect(types.jsxTagEnd);
          return this.finishNode(node, "JSXClosingFragment");
        }

        node.name = this.jsxParseElementName();
        this.expect(types.jsxTagEnd);
        return this.finishNode(node, "JSXClosingElement");
      } // Parses entire JSX element, including it"s opening tag
      // (starting after "<"), attributes, contents and closing tag.


      jsxParseElementAt(startPos: number, startLoc: Position): Node {
        var node = this.startNodeAt(startPos!, startLoc);
        var children = [];
        var openingElement = this.jsxParseOpeningElementAt(startPos, startLoc);
        var closingElement = null;

        if (!openingElement.selfClosing) {
          contents: for (;;) {
            switch (this.state.type) {
              case types.jsxTagStart:
                startPos = this.state.start;
                startLoc = this.state.startLoc;
                this.next();

                if (this.eat(types.slash)) {
                  closingElement = this.jsxParseClosingElementAt(startPos, startLoc);
                  break contents;
                }

                children.push(this.jsxParseElementAt(startPos, startLoc));
                break;

              case types.jsxText:
                children.push(this.parseExprAtom());
                break;

              case types.braceL:
                if (this.lookahead().type === types.ellipsis) {
                  children.push(this.jsxParseSpreadChild());
                } else {
                  children.push(this.jsxParseExpressionContainer());
                }

                break;
              // istanbul ignore next - should never happen

              default:
                throw this.unexpected();
            }
          }

          if (isFragment(openingElement) && !isFragment(closingElement)) {
            this.raise( // $FlowIgnore
            closingElement.start, "Expected corresponding JSX closing tag for <>");
          } else if (!isFragment(openingElement) && isFragment(closingElement)) {
            this.raise( // $FlowIgnore
            closingElement.start, "Expected corresponding JSX closing tag for <" + getQualifiedJSXName(nodeValue(openingElement.name)) + ">");
          } else if (!isFragment(openingElement) && !isFragment(closingElement)) {
            if ( // $FlowIgnore
            getQualifiedJSXName(nodeValue(closingElement.name)) !== getQualifiedJSXName(nodeValue(openingElement.name))) {
              this.raise( // $FlowIgnore
              closingElement.start, "Expected corresponding JSX closing tag for <" + getQualifiedJSXName(nodeValue(openingElement.name)) + ">");
            }
          }
        }

        if (isFragment(openingElement)) {
          node.openingFragment = openingElement;
          node.closingFragment = closingElement;
        } else {
          node.openingElement = openingElement;
          node.closingElement = closingElement;
        }

        node.children = children;

        if (this.match(types.relational) && this.state.value === "<") {
          this.raise(this.state.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
        }

        return isFragment(openingElement) ? this.finishNode(node, "JSXFragment") : this.finishNode(node, "JSXElement");
      } // Parses entire JSX element from current position.


      jsxParseElement(): Node {
        var startPos = this.state.start;
        var startLoc = this.state.startLoc;
        this.next();
        return this.jsxParseElementAt(startPos, startLoc);
      } // ==================================
      // Overrides
      // ==================================


      parseExprAtom(refShortHandDefaultPos?: StartReference): Node {
        if (this.match(types.jsxText)) {
          return this.parseLiteral(this.state.value, "JSXText");
        } else if (this.match(types.jsxTagStart)) {
          return this.jsxParseElement();
        } else {
          return superClass.prototype.parseExprAtom.call(this, refShortHandDefaultPos);
        }
      }

      readToken(code: number): void {
        if (this.state.inPropertyName) return superClass.prototype.readToken.call(this, code);
        var context = this.curContext();

        if (context === types$1.j_expr) {
          return this.jsxReadToken();
        }

        if (context === types$1.j_oTag || context === types$1.j_cTag) {
          if (isIdentifierStart(code)) {
            return this.jsxReadWord();
          }

          if (code === 62) {
            ++this.state.pos;
            return this.finishToken(types.jsxTagEnd);
          }

          if ((code === 34 || code === 39) && context === types$1.j_oTag) {
            return this.jsxReadString(code);
          }
        }

        if (code === 60 && this.state.exprAllowed) {
          ++this.state.pos;
          return this.finishToken(types.jsxTagStart);
        }

        return superClass.prototype.readToken.call(this, code);
      }

      updateContext(prevType: TokenType): void {
        if (this.match(types.braceL)) {
          var curContext = this.curContext();

          if (curContext === types$1.j_oTag) {
            this.state.context.push(types$1.braceExpression);
          } else if (curContext === types$1.j_expr) {
            this.state.context.push(types$1.templateQuasi);
          } else {
            superClass.prototype.updateContext.call(this, prevType);
          }

          this.state.exprAllowed = true;
        } else if (this.match(types.slash) && prevType === types.jsxTagStart) {
          this.state.context.length -= 2; // do not consider JSX expr -> JSX open tag -> ... anymore

          this.state.context.push(types$1.j_cTag); // reconsider as closing tag context

          this.state.exprAllowed = false;
        } else {
          return superClass.prototype.updateContext.call(this, prevType);
        }
      }

      
}
  );
});

function nonNull<T>(x: T | null | undefined): T {
  if (x == null) {
    // $FlowIgnore
    throw new Error(`Unexpected ${x} value.`);
  }

  return x;
}

function assert(x: unknown): asserts x {
  if (!x) {
    throw new Error("Assert fail");
  }
}

// Doesn't handle "void" or "null" because those are keywords, not identifiers.
function keywordTypeFromName(value: NodeValue): string | undefined {
  switch (value) {
    case "any":
      return "TSAnyKeyword";

    case "boolean":
      return "TSBooleanKeyword";

    case "never":
      return "TSNeverKeyword";

    case "number":
      return "TSNumberKeyword";

    case "object":
      return "TSObjectKeyword";

    case "string":
      return "TSStringKeyword";

    case "symbol":
      return "TSSymbolKeyword";

    case "undefined":
      return "TSUndefinedKeyword";

    default:
      return undefined;
  }
}

var typescriptPlugin = (function (superClass: typeof Parser) {
  return (
    /*#__PURE__*/
    class _class extends superClass {
      

      

      

      tsIsIdentifier(): boolean {
        // TODO: actually a bit more complex in TypeScript, but shouldn't matter.
        // See https://github.com/Microsoft/TypeScript/issues/15008
        return this.match(types.name);
      }

      tsNextTokenCanFollowModifier(): boolean {
        // Note: TypeScript's implementation is much more complicated because
        // more things are considered modifiers there.
        // This implementation only handles modifiers not handled by babylon itself. And "static".
        // TODO: Would be nice to avoid lookahead. Want a hasLineBreakUpNext() method...
        this.next();
        return !this.hasPrecedingLineBreak() && !this.match(types.parenL) && !this.match(types.colon) && !this.match(types.eq) && !this.match(types.question);
      }
      /** Parses a modifier matching one the given modifier names. */


      tsParseModifier(allowedModifiers: string[]): string | undefined {
        if (!this.match(types.name)) {
          return undefined;
        }

        var modifier = stringValue(this.state.value);

        if (allowedModifiers.indexOf(modifier) !== -1 && this.tsTryParse(this.tsNextTokenCanFollowModifier.bind(this))) {
          return modifier;
        }

        return undefined;
      }

      tsIsListTerminator(kind: string): boolean {
        switch (kind) {
          case "EnumMembers":
          case "TypeMembers":
            return this.match(types.braceR);

          case "HeritageClauseElement":
            return this.match(types.braceL);

          case "TupleElementTypes":
            return this.match(types.bracketR);

          case "TypeParametersOrArguments":
            return this.isRelational(">");
        }

        throw new Error("Unreachable");
      }

      tsParseList<T>(kind: string, parseElement: () => T): T[] {
        var result = [];

        while (!this.tsIsListTerminator(kind)) {
          // Skipping "parseListElement" from the TS source since that's just for error handling.
          result.push(parseElement());
        }

        return result;
      }

      tsParseDelimitedList<T>(kind: string, parseElement: () => T): T[] {
        return nonNull(this.tsParseDelimitedListWorker(kind, parseElement,
        /* expectSuccess */
        true));
      }

      tsTryParseDelimitedList<T>(kind: string, parseElement: () => T): T[] | undefined {
        return this.tsParseDelimitedListWorker(kind, parseElement,
        /* expectSuccess */
        false);
      }
      /**
      * If !expectSuccess, returns undefined instead of failing to parse.
      * If expectSuccess, parseElement should always return a defined value.
      */


      tsParseDelimitedListWorker<T>(kind: string, parseElement: () => T, expectSuccess?: boolean): T[] | undefined {
        var result = [];

        while (true) {
          if (this.tsIsListTerminator(kind)) {
            break;
          }

          var element = parseElement();

          if (element == null) {
            return undefined;
          }

          result.push(element);

          if (this.eat(types.comma)) {
            continue;
          }

          if (this.tsIsListTerminator(kind)) {
            break;
          }

          if (expectSuccess) {
            // This will fail with an error about a missing comma
            this.expect(types.comma);
          }

          return undefined;
        }

        return result;
      }

      tsParseBracketedList<T>(kind: string, parseElement: () => T, bracket: boolean, skipFirstToken?: boolean): T[] {
        if (!skipFirstToken) {
          if (bracket) {
            this.expect(types.bracketL);
          } else {
            this.expectRelational("<");
          }
        }

        var result = this.tsParseDelimitedList(kind, parseElement);

        if (bracket) {
          this.expect(types.bracketR);
        } else {
          this.expectRelational(">");
        }

        return result;
      }

      tsParseEntityName(allowReservedWords?: boolean): Node {
        var entity = this.parseIdentifier();

        while (this.eat(types.dot)) {
          var node = this.startNodeAtNode(entity);
          node.left = entity;
          node.right = this.parseIdentifier(allowReservedWords);
          entity = this.finishNode(node, "TSQualifiedName");
        }

        return entity;
      }

      tsParseTypeReference(): Node {
        var node = this.startNode();
        node.typeName = this.tsParseEntityName(
        /* allowReservedWords */
        false);

        if (!this.hasPrecedingLineBreak() && this.isRelational("<")) {
          node.typeParameters = this.tsParseTypeArguments();
        }

        return this.finishNode(node, "TSTypeReference");
      }

      tsParseThisTypePredicate(lhs: Node): Node {
        this.next();
        var node = this.startNode();
        node.parameterName = lhs;
        node.typeAnnotation = this.tsParseTypeAnnotation(
        /* eatColon */
        false);
        return this.finishNode(node, "TSTypePredicate");
      }

      tsParseThisTypeNode(): Node {
        var node = this.startNode();
        this.next();
        return this.finishNode(node, "TSThisType");
      }

      tsParseTypeQuery(): Node {
        var node = this.startNode();
        this.expect(types._typeof);
        node.exprName = this.tsParseEntityName(
        /* allowReservedWords */
        true);
        return this.finishNode(node, "TSTypeQuery");
      }

      tsParseTypeParameter(): Node {
        var node = this.startNode();
        node.name = this.parseIdentifierName(node.start);

        if (this.eat(types._extends)) {
          node.constraint = this.tsParseType();
        }

        if (this.eat(types.eq)) {
          node.default = this.tsParseType();
        }

        return this.finishNode(node, "TSTypeParameter");
      }

      tsTryParseTypeParameters(): Node | undefined {
        if (this.isRelational("<")) {
          return this.tsParseTypeParameters();
        }
      }

      tsParseTypeParameters(): Node {
        var node = this.startNode();

        if (this.isRelational("<") || this.match(types.jsxTagStart)) {
          this.next();
        } else {
          this.unexpected();
        }

        node.params = this.tsParseBracketedList("TypeParametersOrArguments", this.tsParseTypeParameter.bind(this),
        /* bracket */
        false,
        /* skipFirstToken */
        true);
        return this.finishNode(node, "TSTypeParameterDeclaration");
      } // Note: In TypeScript implementation we must provide `yieldContext` and `awaitContext`,
      // but here it's always false, because this is only used for types.


      tsFillSignature(returnToken: TokenType, signature: Node): void {
        // Arrow fns *must* have return token (`=>`). Normal functions can omit it.
        var returnTokenRequired = returnToken === types.arrow;
        signature.typeParameters = this.tsTryParseTypeParameters();
        this.expect(types.parenL);
        signature.parameters = this.tsParseBindingListForSignature();

        if (returnTokenRequired) {
          signature.typeAnnotation = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
        } else if (this.match(returnToken)) {
          signature.typeAnnotation = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
        }
      }

      tsParseBindingListForSignature(): (Node | null)[] {
        var _this = this;

        return this.parseBindingList(types.parenR).map(function (pattern) {
          if (pattern!.type !== "Identifier" && pattern!.type !== "RestElement") {
            throw _this.unexpected(pattern!.start, "Name in a signature must be an Identifier.");
          }

          return pattern;
        });
      }

      tsParseTypeMemberSemicolon(): void {
        if (!this.eat(types.comma)) {
          this.semicolon();
        }
      }

      tsParseSignatureMember(kind: string): Node {
        var node = this.startNode();

        if (kind === "TSConstructSignatureDeclaration") {
          this.expect(types._new);
        }

        this.tsFillSignature(types.colon, node);
        this.tsParseTypeMemberSemicolon();
        return this.finishNode(node, kind);
      }

      tsIsUnambiguouslyIndexSignature(): boolean {
        this.next(); // Skip '{'

        return this.eat(types.name) && this.match(types.colon);
      }

      tsTryParseIndexSignature(node: Node): Node | undefined {
        if (!(this.match(types.bracketL) && this.tsLookAhead(this.tsIsUnambiguouslyIndexSignature.bind(this)))) {
          return undefined;
        }

        this.expect(types.bracketL);
        var id = this.parseIdentifier();
        this.expect(types.colon);
        id.typeAnnotation = this.tsParseTypeAnnotation(
        /* eatColon */
        false);
        this.expect(types.bracketR);
        node.parameters = [id];
        var type = this.tsTryParseTypeAnnotation();
        if (type) node.typeAnnotation = type;
        this.tsParseTypeMemberSemicolon();
        return this.finishNode(node, "TSIndexSignature");
      }

      tsParsePropertyOrMethodSignature(node: Node, readonly?: boolean): Node {
        this.parsePropertyName(node);
        if (this.eat(types.question)) node.optional = true;
        var nodeAny = node;

        if (!readonly && (this.match(types.parenL) || this.isRelational("<"))) {
          var method = nodeAny;
          this.tsFillSignature(types.colon, method);
          this.tsParseTypeMemberSemicolon();
          return this.finishNode(method, "TSMethodSignature");
        } else {
          var property = nodeAny;
          if (readonly) property.readonly = true;
          var type = this.tsTryParseTypeAnnotation();
          if (type) property.typeAnnotation = type;
          this.tsParseTypeMemberSemicolon();
          return this.finishNode(property, "TSPropertySignature");
        }
      }

      tsParseTypeMember(): Node {
        if (this.match(types.parenL) || this.isRelational("<")) {
          return this.tsParseSignatureMember("TSCallSignatureDeclaration");
        }

        if (this.match(types._new) && this.tsLookAhead(this.tsIsStartOfConstructSignature.bind(this))) {
          return this.tsParseSignatureMember("TSConstructSignatureDeclaration");
        } // Instead of fullStart, we create a node here.


        var node = this.startNode();
        var readonly = !!this.tsParseModifier(["readonly"]);
        var idx = this.tsTryParseIndexSignature(node);

        if (idx) {
          if (readonly) node.readonly = true;
          return idx;
        }

        return this.tsParsePropertyOrMethodSignature(node, readonly);
      }

      tsIsStartOfConstructSignature(): boolean {
        this.next();
        return this.match(types.parenL) || this.isRelational("<");
      }

      tsParseTypeLiteral(): Node {
        var node = this.startNode();
        node.members = this.tsParseObjectTypeMembers();
        return this.finishNode(node, "TSTypeLiteral");
      }

      tsParseObjectTypeMembers(): Node[] {
        this.expect(types.braceL);
        var members = this.tsParseList("TypeMembers", this.tsParseTypeMember.bind(this));
        this.expect(types.braceR);
        return members;
      }

      tsIsStartOfMappedType(): boolean {
        this.next();

        if (this.isContextual("readonly")) {
          this.next();
        }

        if (!this.match(types.bracketL)) {
          return false;
        }

        this.next();

        if (!this.tsIsIdentifier()) {
          return false;
        }

        this.next();
        return this.match(types._in);
      }

      tsParseMappedTypeParameter(): Node {
        var node = this.startNode();
        node.name = this.parseIdentifierName(node.start);
        this.expect(types._in);
        node.constraint = this.tsParseType();
        return this.finishNode(node, "TSTypeParameter");
      }

      tsParseMappedType(): Node {
        var node = this.startNode();
        this.expect(types.braceL);

        if (this.eatContextual("readonly")) {
          node.readonly = true;
        }

        this.expect(types.bracketL);
        node.typeParameter = this.tsParseMappedTypeParameter();
        this.expect(types.bracketR);

        if (this.eat(types.question)) {
          node.optional = true;
        }

        node.typeAnnotation = this.tsTryParseType();
        this.semicolon();
        this.expect(types.braceR);
        return this.finishNode(node, "TSMappedType");
      }

      tsParseTupleType(): Node {
        var node = this.startNode();
        node.elementTypes = this.tsParseBracketedList("TupleElementTypes", this.tsParseType.bind(this),
        /* bracket */
        true,
        /* skipFirstToken */
        false);
        return this.finishNode(node, "TSTupleType");
      }

      tsParseParenthesizedType(): Node {
        var node = this.startNode();
        this.expect(types.parenL);
        node.typeAnnotation = this.tsParseType();
        this.expect(types.parenR);
        return this.finishNode(node, "TSParenthesizedType");
      }

      tsParseFunctionOrConstructorType(type: string): Node {
        var node = this.startNode();

        if (type === "TSConstructorType") {
          this.expect(types._new);
        }

        this.tsFillSignature(types.arrow, node);
        return this.finishNode(node, type);
      }

      tsParseLiteralTypeNode(): Node {
        var _this2 = this;

        var node = this.startNode();

        node.literal = function () {
          switch (_this2.state.type) {
            case types.num:
              return _this2.parseLiteral(_this2.state.value, "NumericLiteral");

            case types.string:
              return _this2.parseLiteral(_this2.state.value, "StringLiteral");

            case types._true:
            case types._false:
              return _this2.parseBooleanLiteral();

            default:
              throw _this2.unexpected();
          }
        }();

        return this.finishNode(node, "TSLiteralType");
      }

      tsParseNonArrayType(): Node {
        switch (this.state.type) {
          case types.name:
          case types._void:
          case types._null:
            {
              var type = this.match(types._void) ? "TSVoidKeyword" : this.match(types._null) ? "TSNullKeyword" : keywordTypeFromName(this.state.value);

              if (type !== undefined && this.lookahead().type !== types.dot) {
                var node = this.startNode();
                this.next();
                return this.finishNode(node, type);
              }

              return this.tsParseTypeReference();
            }

          case types.string:
          case types.num:
          case types._true:
          case types._false:
            return this.tsParseLiteralTypeNode();

          case types.plusMin:
            if (this.state.value === "-") {
              var _node = this.startNode();

              this.next();

              if (!this.match(types.num)) {
                throw this.unexpected();
              }

              _node.literal = this.parseLiteral(-this.state.value, "NumericLiteral", _node.start, _node.loc.start);
              return this.finishNode(_node, "TSLiteralType");
            }

            break;

          case types._this:
            {
              var thisKeyword = this.tsParseThisTypeNode();

              if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
                return this.tsParseThisTypePredicate(thisKeyword);
              } else {
                return thisKeyword;
              }
            }

          case types._typeof:
            return this.tsParseTypeQuery();

          case types.braceL:
            return this.tsLookAhead(this.tsIsStartOfMappedType.bind(this)) ? this.tsParseMappedType() : this.tsParseTypeLiteral();

          case types.bracketL:
            return this.tsParseTupleType();

          case types.parenL:
            return this.tsParseParenthesizedType();
        }

        throw this.unexpected();
      }

      tsParseArrayTypeOrHigher(): Node {
        var type = this.tsParseNonArrayType();

        while (!this.hasPrecedingLineBreak() && this.eat(types.bracketL)) {
          if (this.match(types.bracketR)) {
            var node = this.startNodeAtNode(type);
            node.elementType = type;
            this.expect(types.bracketR);
            type = this.finishNode(node, "TSArrayType");
          } else {
            var _node2 = this.startNodeAtNode(type);

            _node2.objectType = type;
            _node2.indexType = this.tsParseType();
            this.expect(types.bracketR);
            type = this.finishNode(_node2, "TSIndexedAccessType");
          }
        }

        return type;
      }

      tsParseTypeOperator(operator: string): Node {
        var node = this.startNode();
        this.expectContextual(operator);
        node.operator = operator;
        node.typeAnnotation = this.tsParseTypeOperatorOrHigher();
        return this.finishNode(node, "TSTypeOperator");
      }

      tsParseTypeOperatorOrHigher(): Node {
        if (this.isContextual("keyof")) {
          return this.tsParseTypeOperator("keyof");
        }

        return this.tsParseArrayTypeOrHigher();
      }

      tsParseUnionOrIntersectionType(kind: string, parseConstituentType: () => Node, operator: TokenType): Node {
        this.eat(operator);
        var type = parseConstituentType();

        if (this.match(operator)) {
          var types$$1 = [type];

          while (this.eat(operator)) {
            types$$1.push(parseConstituentType());
          }

          var node = this.startNodeAtNode(type);
          node.types = types$$1;
          type = this.finishNode(node, kind);
        }

        return type;
      }

      tsParseIntersectionTypeOrHigher(): Node {
        return this.tsParseUnionOrIntersectionType("TSIntersectionType", this.tsParseTypeOperatorOrHigher.bind(this), types.bitwiseAND);
      }

      tsParseUnionTypeOrHigher(): Node {
        return this.tsParseUnionOrIntersectionType("TSUnionType", this.tsParseIntersectionTypeOrHigher.bind(this), types.bitwiseOR);
      }

      tsIsStartOfFunctionType(): boolean {
        if (this.isRelational("<")) {
          return true;
        }

        return this.match(types.parenL) && this.tsLookAhead(this.tsIsUnambiguouslyStartOfFunctionType.bind(this));
      }

      tsSkipParameterStart(): boolean {
        if (this.match(types.name) || this.match(types._this)) {
          this.next();
          return true;
        }

        return false;
      }

      tsIsUnambiguouslyStartOfFunctionType(): boolean {
        this.next();

        if (this.match(types.parenR) || this.match(types.ellipsis)) {
          // ( )
          // ( ...
          return true;
        }

        if (this.tsSkipParameterStart()) {
          if (this.match(types.colon) || this.match(types.comma) || this.match(types.question) || this.match(types.eq)) {
            // ( xxx :
            // ( xxx ,
            // ( xxx ?
            // ( xxx =
            return true;
          }

          if (this.match(types.parenR)) {
            this.next();

            if (this.match(types.arrow)) {
              // ( xxx ) =>
              return true;
            }
          }
        }

        return false;
      }

      tsParseTypeOrTypePredicateAnnotation(returnToken: TokenType): Node {
        var t = this.startNode();
        this.expect(returnToken);
        var typePredicateVariable = this.tsIsIdentifier() && this.tsTryParse(this.tsParseTypePredicatePrefix.bind(this));

        if (!typePredicateVariable) {
          return this.tsParseTypeAnnotation(
          /* eatColon */
          false, t);
        }

        var type = this.tsParseTypeAnnotation(
        /* eatColon */
        false);
        var node = this.startNodeAtNode(typePredicateVariable);
        node.parameterName = typePredicateVariable;
        node.typeAnnotation = type;
        t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
        return this.finishNode(t, "TSTypeAnnotation");
      }

      tsTryParseTypeOrTypePredicateAnnotation(): Node | undefined {
        return this.match(types.colon) ? this.tsParseTypeOrTypePredicateAnnotation(types.colon) : undefined;
      }

      tsTryParseTypeAnnotation(): Node | undefined {
        return this.match(types.colon) ? this.tsParseTypeAnnotation() : undefined;
      }

      tsTryParseType(): Node | undefined {
        return this.eat(types.colon) ? this.tsParseType() : undefined;
      }

      tsParseTypePredicatePrefix(): Node | undefined {
        var id = this.parseIdentifier();

        if (this.isContextual("is") && !this.hasPrecedingLineBreak()) {
          this.next();
          return id;
        }
      }

      tsParseTypeAnnotation(eatColon?: boolean, t?: Node): Node {
        if (eatColon === void 0) {
          eatColon = true;
        }

        if (t === void 0) {
          t = this.startNode();
        }

        if (eatColon) this.expect(types.colon);
        t.typeAnnotation = this.tsParseType();
        return this.finishNode(t, "TSTypeAnnotation");
      }

      tsParseType(): Node {
        // Need to set `state.inType` so that we don't parse JSX in a type context.
        var oldInType = this.state.inType;
        this.state.inType = true;

        try {
          if (this.tsIsStartOfFunctionType()) {
            return this.tsParseFunctionOrConstructorType("TSFunctionType");
          }

          if (this.match(types._new)) {
            // As in `new () => Date`
            return this.tsParseFunctionOrConstructorType("TSConstructorType");
          }

          return this.tsParseUnionTypeOrHigher();
        } finally {
          this.state.inType = oldInType;
        }
      }

      tsParseTypeAssertion(): Node {
        var node = this.startNode();
        node.typeAnnotation = this.tsParseType();
        this.expectRelational(">");
        node.expression = this.parseMaybeUnary();
        return this.finishNode(node, "TSTypeAssertion");
      }

      tsTryParseTypeArgumentsInExpression(): Node | undefined {
        var _this3 = this;

        return this.tsTryParseAndCatch(function () {
          var res = _this3.startNode();

          _this3.expectRelational("<");

          var typeArguments = _this3.tsParseDelimitedList("TypeParametersOrArguments", _this3.tsParseType.bind(_this3));

          _this3.expectRelational(">");

          res.params = typeArguments;

          _this3.finishNode(res, "TSTypeParameterInstantiation");

          _this3.expect(types.parenL);

          return res;
        });
      }

      tsParseHeritageClause(): Node[] {
        return this.tsParseDelimitedList("HeritageClauseElement", this.tsParseExpressionWithTypeArguments.bind(this));
      }

      tsParseExpressionWithTypeArguments(): Node {
        var node = this.startNode(); // Note: TS uses parseLeftHandSideExpressionOrHigher,
        // then has grammar errors later if it's not an EntityName.

        node.expression = this.tsParseEntityName(
        /* allowReservedWords */
        false);

        if (this.isRelational("<")) {
          node.typeParameters = this.tsParseTypeArguments();
        }

        return this.finishNode(node, "TSExpressionWithTypeArguments");
      }

      tsParseInterfaceDeclaration(node: Node): Node {
        node.id = this.parseIdentifier();
        node.typeParameters = this.tsTryParseTypeParameters();

        if (this.eat(types._extends)) {
          node.extends = this.tsParseHeritageClause();
        }

        var body = this.startNode();
        body.body = this.tsParseObjectTypeMembers();
        node.body = this.finishNode(body, "TSInterfaceBody");
        return this.finishNode(node, "TSInterfaceDeclaration");
      }

      tsParseTypeAliasDeclaration(node: Node): Node {
        node.id = this.parseIdentifier();
        node.typeParameters = this.tsTryParseTypeParameters();
        this.expect(types.eq);
        node.typeAnnotation = this.tsParseType();
        this.semicolon();
        return this.finishNode(node, "TSTypeAliasDeclaration");
      }

      tsParseEnumMember(): Node {
        var node = this.startNode(); // Computed property names are grammar errors in an enum, so accept just string literal or identifier.

        node.id = this.match(types.string) ? this.parseLiteral(this.state.value, "StringLiteral") : this.parseIdentifier(
        /* liberal */
        true);

        if (this.eat(types.eq)) {
          node.initializer = this.parseMaybeAssign();
        }

        return this.finishNode(node, "TSEnumMember");
      }

      tsParseEnumDeclaration(node: Node, isConst?: boolean): Node {
        if (isConst) node.const = true;
        node.id = this.parseIdentifier();
        this.expect(types.braceL);
        node.members = this.tsParseDelimitedList("EnumMembers", this.tsParseEnumMember.bind(this));
        this.expect(types.braceR);
        return this.finishNode(node, "TSEnumDeclaration");
      }

      tsParseModuleBlock(): Node {
        var node = this.startNode();
        this.expect(types.braceL); // Inside of a module block is considered "top-level", meaning it can have imports and exports.

        this.parseBlockOrModuleBlockBody(node.body = [],
        /* directives */
        undefined,
        /* topLevel */
        true,
        /* end */
        types.braceR);
        return this.finishNode(node, "TSModuleBlock");
      }

      tsParseModuleOrNamespaceDeclaration(node: Node): Node {
        node.id = this.parseIdentifier();

        if (this.eat(types.dot)) {
          var inner = this.startNode();
          this.tsParseModuleOrNamespaceDeclaration(inner);
          node.body = inner;
        } else {
          node.body = this.tsParseModuleBlock();
        }

        return this.finishNode(node, "TSModuleDeclaration");
      }

      tsParseAmbientExternalModuleDeclaration(node: Node): Node {
        if (this.isContextual("global")) {
          node.global = true;
          node.id = this.parseIdentifier();
        } else if (this.match(types.string)) {
          node.id = this.parseExprAtom();
        } else {
          this.unexpected();
        }

        if (this.match(types.braceL)) {
          node.body = this.tsParseModuleBlock();
        } else {
          this.semicolon();
        }

        return this.finishNode(node, "TSModuleDeclaration");
      }

      tsParseImportEqualsDeclaration(node: Node, isExport?: boolean): Node {
        node.isExport = isExport || false;
        node.id = this.parseIdentifier();
        this.expect(types.eq);
        node.moduleReference = this.tsParseModuleReference();
        this.semicolon();
        return this.finishNode(node, "TSImportEqualsDeclaration");
      }

      tsIsExternalModuleReference(): boolean {
        return this.isContextual("require") && this.lookahead().type === types.parenL;
      }

      tsParseModuleReference(): Node {
        return this.tsIsExternalModuleReference() ? this.tsParseExternalModuleReference() : this.tsParseEntityName(
        /* allowReservedWords */
        false);
      }

      tsParseExternalModuleReference(): Node {
        var node = this.startNode();
        this.expectContextual("require");
        this.expect(types.parenL);

        if (!this.match(types.string)) {
          throw this.unexpected();
        }

        node.expression = this.parseLiteral(this.state.value, "StringLiteral");
        this.expect(types.parenR);
        return this.finishNode(node, "TSExternalModuleReference");
      } // Utilities


      tsLookAhead<T>(f: () => T): T {
        var state = this.state.clone();
        var res = f();
        this.state = state;
        return res;
      }

      tsTryParseAndCatch<T>(f: () => T): T | undefined {
        var state = this.state.clone();

        try {
          return f();
        } catch (e) {
          if (e instanceof SyntaxError) {
            this.state = state;
            return undefined;
          }

          throw e;
        }
      }

      tsTryParse<T>(f: () => T): T | undefined {
        var state = this.state.clone();
        var result = f();

        if (result !== undefined && result !== false) {
          return result;
        } else {
          this.state = state;
          return undefined;
        }
      }

      nodeWithSamePosition(original: Node, type: string): Node {
        var node = this.startNodeAtNode(original);
        node.type = type;
        node.end = original.end;
        node.loc.end = original.loc.end;

        if (original.leadingComments) {
          node.leadingComments = original.leadingComments;
        }

        if (original.trailingComments) {
          node.trailingComments = original.trailingComments;
        }

        if (original.innerComments) node.innerComments = original.innerComments;
        return node;
      }

      tsTryParseDeclare(nany: Node): Node | undefined {
        switch (this.state.type) {
          case types._function:
            this.next();
            return this.parseFunction(nany,
            /* isStatement */
            true);

          case types._class:
            return this.parseClass(nany,
            /* isStatement */
            true,
            /* optionalId */
            false);

          case types._const:
            if (this.match(types._const) && this.isLookaheadContextual("enum")) {
              // `const enum = 0;` not allowed because "enum" is a strict mode reserved word.
              this.expect(types._const);
              this.expectContextual("enum");
              return this.tsParseEnumDeclaration(nany,
              /* isConst */
              true);
            }

          // falls through

          case types._var:
          case types._let:
            return this.parseVarStatement(nany, this.state.type);

          case types.name:
            {
              var value = this.state.value;

              if (value === "global") {
                return this.tsParseAmbientExternalModuleDeclaration(nany);
              } else {
                return this.tsParseDeclaration(nany, stringValue(value),
                /* next */
                true);
              }
            }
        }
      } // Note: this won't be called unless the keyword is allowed in `shouldParseExportDeclaration`.


      tsTryParseExportDeclaration(): Node | undefined {
        return this.tsParseDeclaration(this.startNode(), stringValue(this.state.value),
        /* next */
        true);
      }

      tsParseExpressionStatement(node: Node, expr: Node): Node | undefined {
        switch (expr.name) {
          case "declare":
            {
              var declaration = this.tsTryParseDeclare(node);

              if (declaration) {
                declaration.declare = true;
                return declaration;
              }

              break;
            }

          case "global":
            // `global { }` (with no `declare`) may appear inside an ambient module declaration.
            // Would like to use tsParseAmbientExternalModuleDeclaration here, but already ran past "global".
            if (this.match(types.braceL)) {
              var mod = node;
              mod.global = true;
              mod.id = expr;
              mod.body = this.tsParseModuleBlock();
              return this.finishNode(mod, "TSModuleDeclaration");
            }

            break;

          default:
            return this.tsParseDeclaration(node, stringValue(expr.name),
            /* next */
            false);
        }
      } // Common to tsTryParseDeclare, tsTryParseExportDeclaration, and tsParseExpressionStatement.


      tsParseDeclaration(node: Node, value: string, next?: boolean): Node | undefined {
        switch (value) {
          case "abstract":
            if (next || this.match(types._class)) {
              var cls = node;
              cls.abstract = true;
              if (next) this.next();
              return this.parseClass(cls,
              /* isStatement */
              true,
              /* optionalId */
              false);
            }

            break;

          case "enum":
            if (next || this.match(types.name)) {
              if (next) this.next();
              return this.tsParseEnumDeclaration(node,
              /* isConst */
              false);
            }

            break;

          case "interface":
            if (next || this.match(types.name)) {
              if (next) this.next();
              return this.tsParseInterfaceDeclaration(node);
            }

            break;

          case "module":
            if (next) this.next();

            if (this.match(types.string)) {
              return this.tsParseAmbientExternalModuleDeclaration(node);
            } else if (next || this.match(types.name)) {
              return this.tsParseModuleOrNamespaceDeclaration(node);
            }

            break;

          case "namespace":
            if (next || this.match(types.name)) {
              if (next) this.next();
              return this.tsParseModuleOrNamespaceDeclaration(node);
            }

            break;

          case "type":
            if (next || this.match(types.name)) {
              if (next) this.next();
              return this.tsParseTypeAliasDeclaration(node);
            }

            break;
        }
      }

      tsTryParseGenericAsyncArrowFunction(startPos: number, startLoc: Position): Node | undefined {
        var _this4 = this;

        var res = this.tsTryParseAndCatch(function () {
          var node = _this4.startNodeAt(startPos, startLoc);

          node.typeParameters = _this4.tsParseTypeParameters(); // Don't use overloaded parseFunctionParams which would look for "<" again.

          superClass.prototype.parseFunctionParams.call(_this4, node);

          node.returnType = _this4.tsTryParseTypeOrTypePredicateAnnotation();

          _this4.expect(types.arrow);

          return node;
        });

        if (!res) {
          return undefined;
        }

        res.id = null;
        res.generator = false;
        res.expression = true; // May be set again by parseFunctionBody.

        res.async = true;
        this.parseFunctionBody(res, true);
        return this.finishNode(res, "ArrowFunctionExpression");
      }

      tsParseTypeArguments(): Node {
        var node = this.startNode();
        this.expectRelational("<");
        node.params = this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
        this.expectRelational(">");
        return this.finishNode(node, "TSTypeParameterInstantiation");
      }

      tsIsDeclarationStart(): boolean {
        if (this.match(types.name)) {
          switch (this.state.value) {
            case "abstract":
            case "declare":
            case "enum":
            case "interface":
            case "module":
            case "namespace":
            case "type":
              return true;
          }
        }

        return false;
      } // ======================================================
      // OVERRIDES
      // ======================================================


      isExportDefaultSpecifier(): boolean {
        if (this.tsIsDeclarationStart()) return false;
        return superClass.prototype.isExportDefaultSpecifier.call(this);
      }

      parseAssignableListItem(allowModifiers?: boolean, decorators?: Node[]): Node {
        var accessibility;
        var readonly = false;

        if (allowModifiers) {
          accessibility = this.parseAccessModifier();
          readonly = !!this.tsParseModifier(["readonly"]);
        }

        var left = this.parseMaybeDefault();
        this.parseAssignableListItemTypes(left);
        var elt = this.parseMaybeDefault(left.start, left.loc.start, left);

        if (accessibility || readonly) {
          var pp = this.startNodeAtNode(elt);

          if (decorators!.length) {
            pp.decorators = decorators!;
          }

          if (accessibility) pp.accessibility = accessibility;
          if (readonly) pp.readonly = readonly;

          if (elt.type !== "Identifier" && elt.type !== "AssignmentPattern") {
            throw this.raise(pp.start, "A parameter property may not be declared using a binding pattern.");
          }

          pp.parameter = elt;
          return this.finishNode(pp, "TSParameterProperty");
        } else {
          if (decorators!.length) {
            left.decorators = decorators!;
          }

          return elt;
        }
      }

      parseFunctionBodyAndFinish(node: Node, type: string | undefined, allowExpressionBody?: boolean): void {
        // For arrow functions, `parseArrow` handles the return type itself.
        if (!allowExpressionBody && this.match(types.colon)) {
          node.returnType = this.tsParseTypeOrTypePredicateAnnotation(types.colon);
        }

        var bodilessType = type === "FunctionDeclaration" ? "TSDeclareFunction" : type === "ClassMethod" ? "TSDeclareMethod" : undefined;

        if (bodilessType && !this.match(types.braceL) && this.isLineTerminator()) {
          this.finishNode(node, bodilessType);
          return;
        }

        superClass.prototype.parseFunctionBodyAndFinish.call(this, node, type, allowExpressionBody);
      }

      parseSubscript(base: Node, startPos: number, startLoc: Position, noCalls: boolean | undefined, state: SubscriptState): Node {
        if (this.eat(types.bang)) {
          var nonNullExpression = this.startNodeAt(startPos!, startLoc);
          nonNullExpression.expression = base;
          return this.finishNode(nonNullExpression, "TSNonNullExpression");
        }

        if (!noCalls && this.isRelational("<")) {
          if (this.atPossibleAsync(base)) {
            // Almost certainly this is a generic async function `async <T>() => ...
            // But it might be a call with a type argument `async<T>();`
            var asyncArrowFn = this.tsTryParseGenericAsyncArrowFunction(startPos, startLoc);

            if (asyncArrowFn) {
              return asyncArrowFn;
            }
          }

          var node = this.startNodeAt(startPos!, startLoc);
          node.callee = base; // May be passing type arguments. But may just be the `<` operator.

          var typeArguments = this.tsTryParseTypeArgumentsInExpression(); // Also eats the "("

          if (typeArguments) {
            // possibleAsync always false here, because we would have handled it above.
            // $FlowIgnore (won't be any undefined arguments)
            node.arguments = this.parseCallExpressionArguments(types.parenR,
            /* possibleAsync */
            false);
            node.typeParameters = typeArguments;
            return this.finishCallExpression(node);
          }
        }

        return superClass.prototype.parseSubscript.call(this, base, startPos, startLoc, noCalls, state);
      }

      parseNewArguments(node: Node): void {
        var _this5 = this;

        if (this.isRelational("<")) {
          // tsTryParseAndCatch is expensive, so avoid if not necessary.
          // 99% certain this is `new C<T>();`. But may be `new C < T;`, which is also legal.
          var typeParameters = this.tsTryParseAndCatch(function () {
            var args = _this5.tsParseTypeArguments();

            if (!_this5.match(types.parenL)) _this5.unexpected();
            return args;
          });

          if (typeParameters) {
            node.typeParameters = typeParameters;
          }
        }

        superClass.prototype.parseNewArguments.call(this, node);
      }

      parseExprOp(left: Node, leftStartPos: number, leftStartLoc: Position, minPrec: number, noIn: boolean | undefined): Node {
        if (nonNull(types._in.binop) > minPrec && !this.hasPrecedingLineBreak() && this.eatContextual("as")) {
          var node = this.startNodeAt(leftStartPos, leftStartLoc);
          node.expression = left;
          node.typeAnnotation = this.tsParseType();
          this.finishNode(node, "TSAsExpression");
          return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
        }

        return superClass.prototype.parseExprOp.call(this, left, leftStartPos, leftStartLoc, minPrec, noIn);
      }

      checkReservedWord(word: string | Node, startLoc: number, checkKeywords?: boolean, isBinding?: boolean): void {}

      checkDuplicateExports(): void {}

      parseImport(node: Node): Node {
        if (this.match(types.name) && this.lookahead().type === types.eq) {
          return this.tsParseImportEqualsDeclaration(node);
        }

        return superClass.prototype.parseImport.call(this, node);
      }

      parseExport(node: Node): Node {
        if (this.match(types._import)) {
          // `export import A = B;`
          this.expect(types._import);
          return this.tsParseImportEqualsDeclaration(node,
          /* isExport */
          true);
        } else if (this.eat(types.eq)) {
          // `export = x;`
          var assign = node;
          assign.expression = this.parseExpression();
          this.semicolon();
          return this.finishNode(assign, "TSExportAssignment");
        } else if (this.eatContextual("as")) {
          // `export as namespace A;`
          var decl = node; // See `parseNamespaceExportDeclaration` in TypeScript's own parser

          this.expectContextual("namespace");
          decl.id = this.parseIdentifier();
          this.semicolon();
          return this.finishNode(decl, "TSNamespaceExportDeclaration");
        } else {
          return superClass.prototype.parseExport.call(this, node);
        }
      }

      parseStatementContent(declaration?: boolean, topLevel?: boolean): Node {
        if (this.state.type === types._const) {
          var ahead = this.lookahead();

          if (ahead.type === types.name && ahead.value === "enum") {
            var node = this.startNode();
            this.expect(types._const);
            this.expectContextual("enum");
            return this.tsParseEnumDeclaration(node,
            /* isConst */
            true);
          }
        }

        return superClass.prototype.parseStatementContent.call(this, declaration, topLevel);
      }

      parseAccessModifier(): string | null | undefined {
        return this.tsParseModifier(["public", "protected", "private"]);
      }

      parseClassMember(classBody: Node, member: Node, state: ClassBodyState): void {
        var accessibility = this.parseAccessModifier();
        if (accessibility) member.accessibility = accessibility;

        superClass.prototype.parseClassMember.call(this, classBody, member, state);
      }

      parseClassMemberWithIsStatic(classBody: Node, member: Node, state: ClassBodyState, isStatic: boolean): void {
        var methodOrProp = member;
        var prop = member;
        var propOrIdx = member;
        var abstract = false,
            readonly = false;
        var mod = this.tsParseModifier(["abstract", "readonly"]);

        switch (mod) {
          case "readonly":
            readonly = true;
            abstract = !!this.tsParseModifier(["abstract"]);
            break;

          case "abstract":
            abstract = true;
            readonly = !!this.tsParseModifier(["readonly"]);
            break;
        }

        if (abstract) methodOrProp.abstract = true;
        if (readonly) propOrIdx.readonly = true;

        if (!abstract && !isStatic && !methodOrProp.accessibility) {
          var idx = this.tsTryParseIndexSignature(member);

          if (idx) {
            nodeArray(classBody.body).push(idx);
            return;
          }
        }

        if (readonly) {
          // Must be a property (if not an index signature).
          methodOrProp.static = isStatic;
          this.parseClassPropertyName(prop);
          this.parsePostMemberNameModifiers(methodOrProp);
          this.pushClassProperty(classBody, prop);
          return;
        }

        superClass.prototype.parseClassMemberWithIsStatic.call(this, classBody, member, state, isStatic);
      }

      parsePostMemberNameModifiers(methodOrProp: Node): void {
        var optional = this.eat(types.question);
        if (optional) methodOrProp.optional = true;
      } // Note: The reason we do this in `parseExpressionStatement` and not `parseStatement`
      // is that e.g. `type()` is valid JS, so we must try parsing that first.
      // If it's really a type, we will parse `type` as the statement, and can correct it here
      // by parsing the rest.


      parseExpressionStatement(node: Node, expr: Node): Node {
        var decl = expr.type === "Identifier" ? this.tsParseExpressionStatement(node, expr) : undefined;
        return decl || superClass.prototype.parseExpressionStatement.call(this, node, expr);
      } // export type
      // Should be true for anything parsed by `tsTryParseExportDeclaration`.


      shouldParseExportDeclaration(): boolean {
        if (this.tsIsDeclarationStart()) return true;
        return superClass.prototype.shouldParseExportDeclaration.call(this);
      } // An apparent conditional expression could actually be an optional parameter in an arrow function.


      parseConditional(expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position, refNeedsArrowPos?: StartReference): Node {
        // only do the expensive clone if there is a question mark
        // and if we come from inside parens
        if (!refNeedsArrowPos || !this.match(types.question)) {
          return superClass.prototype.parseConditional.call(this, expr, noIn, startPos, startLoc, refNeedsArrowPos);
        }

        var state = this.state.clone();

        try {
          return superClass.prototype.parseConditional.call(this, expr, noIn, startPos, startLoc);
        } catch (err) {
          if (!(err instanceof SyntaxError)) {
            // istanbul ignore next: no such error is expected
            throw err;
          }

          this.state = state;
          refNeedsArrowPos.start = ("pos" in err && typeof err.pos === "number" ? err.pos : 0) || this.state.start;
          return expr;
        }
      } // Note: These "type casts" are *not* valid TS expressions.
      // But we parse them here and change them when completing the arrow function.


      parseParenItem(node: Node, startPos?: number, startLoc?: Position): Node {
        node = superClass.prototype.parseParenItem.call(this, node, startPos, startLoc);

        if (this.eat(types.question)) {
          node.optional = true;
        }

        if (this.match(types.colon)) {
          var typeCastNode = this.startNodeAt(startPos!, startLoc);
          typeCastNode.expression = node;
          typeCastNode.typeAnnotation = this.tsParseTypeAnnotation();
          return this.finishNode(typeCastNode, "TSTypeCastExpression");
        }

        return node;
      }

      parseExportDeclaration(node?: Node): Node | null {
        // "export declare" is equivalent to just "export".
        var isDeclare = this.eatContextual("declare");
        var declaration;

        if (this.match(types.name)) {
          declaration = this.tsTryParseExportDeclaration();
        }

        if (!declaration) {
          declaration = superClass.prototype.parseExportDeclaration.call(this, node);
        }

        if (declaration && isDeclare) {
          declaration.declare = true;
        }

        return declaration;
      }

      parseClassId(...args: Parameters<Parser["parseClassId"]>): void {
        const [node, isStatement, optionalId] = args;

        if ((!isStatement || optionalId) && this.isContextual("implements")) {
          return;
        }

        superClass.prototype.parseClassId.call(this, ...args);

        var typeParameters = this.tsTryParseTypeParameters();
        if (typeParameters) node.typeParameters = typeParameters;
      }

      parseClassProperty(node: Node): Node {
        var type = this.tsTryParseTypeAnnotation();
        if (type) node.typeAnnotation = type;
        return superClass.prototype.parseClassProperty.call(this, node);
      }

      pushClassMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isConstructor?: boolean): void {
        var typeParameters = this.tsTryParseTypeParameters();
        if (typeParameters) method.typeParameters = typeParameters;

        superClass.prototype.pushClassMethod.call(this, classBody, method, isGenerator, isAsync, isConstructor);
      }

      pushClassPrivateMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined): void {
        var typeParameters = this.tsTryParseTypeParameters();
        if (typeParameters) method.typeParameters = typeParameters;

        superClass.prototype.pushClassPrivateMethod.call(this, classBody, method, isGenerator, isAsync);
      }

      parseClassSuper(node: Node): void {
        superClass.prototype.parseClassSuper.call(this, node);

        if (node.superClass && this.isRelational("<")) {
          node.superTypeParameters = this.tsParseTypeArguments();
        }

        if (this.eatContextual("implements")) {
          node.implements = this.tsParseHeritageClause();
        }
      }

      parseObjPropValue(...args: Parameters<Parser["parseObjPropValue"]>): Node | void {

        if (this.isRelational("<")) {
          throw new Error("TODO");
        }


        superClass.prototype.parseObjPropValue.call(this, ...args);
      }

      parseFunctionParams(node: Node, allowModifiers?: boolean): void {
        var typeParameters = this.tsTryParseTypeParameters();
        if (typeParameters) node.typeParameters = typeParameters;

        superClass.prototype.parseFunctionParams.call(this, node, allowModifiers);
      } // `let x: number;`


      parseVarHead(decl: Node): void {
        superClass.prototype.parseVarHead.call(this, decl);

        var type = this.tsTryParseTypeAnnotation();

        if (type) {
          decl.id!.typeAnnotation = type;
          this.finishNode(decl.id!, decl.id!.type); // set end position to end of type
        }
      } // parse the return type of an async arrow function - let foo = (async (): number => {});


      parseAsyncArrowFromCallExpression(node: Node, call: Node): Node {
        if (this.match(types.colon)) {
          node.returnType = this.tsParseTypeAnnotation();
        }

        return superClass.prototype.parseAsyncArrowFromCallExpression.call(this, node, call);
      }

      parseMaybeAssign(...args: Parameters<Parser["parseMaybeAssign"]>): Node {
        // Note: When the JSX plugin is on, type assertions (`<T> x`) aren't valid syntax.
        var jsxError;


        if (this.match(types.jsxTagStart)) {
          var context = this.curContext();
          assert(context === types$1.j_oTag); // Only time j_oTag is pushed is right after j_expr.

          assert(this.state.context[this.state.context.length - 2] === types$1.j_expr); // Prefer to parse JSX if possible. But may be an arrow fn.

          var _state = this.state.clone();

          try {

            return superClass.prototype.parseMaybeAssign.call(this, ...args);
          } catch (err) {
            if (!(err instanceof SyntaxError)) {
              // istanbul ignore next: no such error is expected
              throw err;
            }

            this.state = _state; // Pop the context added by the jsxTagStart.

            assert(this.curContext() === types$1.j_oTag);
            this.state.context.pop();
            assert(this.curContext() === types$1.j_expr);
            this.state.context.pop();
            jsxError = err;
          }
        }

        if (jsxError === undefined && !this.isRelational("<")) {

          return superClass.prototype.parseMaybeAssign.call(this, ...args);
        } // Either way, we're looking at a '<': tt.jsxTagStart or relational.


        var arrowExpression;
        var typeParameters;
        var state = this.state.clone();

        try {

          // This is similar to TypeScript's `tryParseParenthesizedArrowFunctionExpression`.
          typeParameters = this.tsParseTypeParameters();
          arrowExpression = superClass.prototype.parseMaybeAssign.call(this, ...args);

          if (arrowExpression.type !== "ArrowFunctionExpression") {
            this.unexpected(); // Go to the catch block (needs a SyntaxError).
          }
        } catch (err) {

          if (!(err instanceof SyntaxError)) {
            // istanbul ignore next: no such error is expected
            throw err;
          }

          if (jsxError) {
            throw jsxError;
          } // Try parsing a type cast instead of an arrow function.
          // This will never happen outside of JSX.
          // (Because in JSX the '<' should be a jsxTagStart and not a relational.


          assert(!this.hasPlugin("jsx")); // Parsing an arrow function failed, so try a type cast.

          this.state = state; // This will start with a type assertion (via parseMaybeUnary).
          // But don't directly call `this.tsParseTypeAssertion` because we want to handle any binary after it.

          return superClass.prototype.parseMaybeAssign.call(this, ...args);
        } // Correct TypeScript code should have at least 1 type parameter, but don't crash on bad code.


        if (typeParameters && typeParameters.params.length !== 0) {
          this.resetStartLocationFromNode(arrowExpression, typeParameters.params[0]!);
        }

        arrowExpression.typeParameters = typeParameters;
        return arrowExpression;
      } // Handle type assertions


      parseMaybeUnary(refShorthandDefaultPos?: StartReference | undefined): Node {
        if (!this.hasPlugin("jsx") && this.eatRelational("<")) {
          return this.tsParseTypeAssertion();
        } else {
          return superClass.prototype.parseMaybeUnary.call(this, refShorthandDefaultPos);
        }
      }

      parseArrow(node: Node): Node | undefined {
        if (this.match(types.colon)) {
          // This is different from how the TS parser does it.
          // TS uses lookahead. Babylon parses it as a parenthesized expression and converts.
          var state = this.state.clone();

          try {
            var returnType = this.tsParseTypeOrTypePredicateAnnotation(types.colon);
            if (this.canInsertSemicolon()) this.unexpected();
            if (!this.match(types.arrow)) this.unexpected();
            node.returnType = returnType;
          } catch (err) {
            if (err instanceof SyntaxError) {
              this.state = state;
            } else {
              // istanbul ignore next: no such error is expected
              throw err;
            }
          }
        }

        return superClass.prototype.parseArrow.call(this, node);
      } // Allow type annotations inside of a parameter list.


      parseAssignableListItemTypes(param: Node): Node {
        if (this.eat(types.question)) {
          if (param.type !== "Identifier") {
            throw this.raise(param.start, "A binding pattern parameter cannot be optional in an implementation signature.");
          }

          param.optional = true;
        }

        var type = this.tsTryParseTypeAnnotation();
        if (type) param.typeAnnotation = type;
        return this.finishNode(param, param.type);
      }

      toAssignable(node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null {
        switch (node!.type) {
          case "TSTypeCastExpression":
            return superClass.prototype.toAssignable.call(this, this.typeCastToParameter(node!), isBinding, contextDescription);

          case "TSParameterProperty":
            return superClass.prototype.toAssignable.call(this, node, isBinding, contextDescription);

          default:
            return superClass.prototype.toAssignable.call(this, node, isBinding, contextDescription);
        }
      }

      checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void {
        switch (expr.type) {
          case "TSTypeCastExpression":
            // Allow "typecasts" to appear on the left of assignment expressions,
            // because it may be in an arrow function.
            // e.g. `const f = (foo: number = 0) => foo;`
            return;

          case "TSParameterProperty":
            this.checkLVal(expr.parameter, isBinding, checkClashes, "parameter property");
            return;

          default:
            superClass.prototype.checkLVal.call(this, expr, isBinding, checkClashes, contextDescription);

            return;
        }
      }

      parseBindingAtom(): Node {
        switch (this.state.type) {
          case types._this:
            // "this" may be the name of a parameter, so allow it.
            return this.parseIdentifier(
            /* liberal */
            true);

          default:
            return superClass.prototype.parseBindingAtom.call(this);
        }
      } // === === === === === === === === === === === === === === === ===
      // Note: All below methods are duplicates of something in flow.js.
      // Not sure what the best way to combine these is.
      // === === === === === === === === === === === === === === === ===


      isClassMethod(): boolean {
        return this.isRelational("<") || superClass.prototype.isClassMethod.call(this);
      }

      isClassProperty(): boolean {
        return this.match(types.colon) || superClass.prototype.isClassProperty.call(this);
      }

      parseMaybeDefault(...args: Parameters<Parser["parseMaybeDefault"]>): Node {


        var node = superClass.prototype.parseMaybeDefault.call(this, ...args);

        if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
          this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, " + "e.g. instead of `age = 25: number` use `age: number = 25`");
        }

        return node;
      } // ensure that inside types, we bypass the jsx parser plugin


      readToken(code: number): void {
        if (this.state.inType && (code === 62 || code === 60)) {
          return this.finishOp(types.relational, 1);
        } else {
          return superClass.prototype.readToken.call(this, code);
        }
      }

      toAssignableList(exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[] {
        for (var i = 0; i < exprList.length; i++) {
          var expr = exprList[i];

          if (expr && expr.type === "TSTypeCastExpression") {
            exprList[i] = this.typeCastToParameter(expr);
          }
        }

        return superClass.prototype.toAssignableList.call(this, exprList, isBinding, contextDescription);
      }

      typeCastToParameter(node: Node): Node {
        nodeValue(node.expression).typeAnnotation = node.typeAnnotation;
        return this.finishNodeAt(nodeValue(node.expression), nodeValue(node.expression).type, node.typeAnnotation!.end, node.typeAnnotation!.loc.end);
      }

      toReferencedList(exprList: (Node | null)[]): (Node | null)[] {
        for (var i = 0; i < exprList.length; i++) {
          var expr = exprList[i];

          if (expr && expr._exprListItem && expr.type === "TsTypeCastExpression") {
            this.raise(expr.start, "Did not expect a type annotation here.");
          }
        }

        return exprList;
      }

      shouldParseArrow(): boolean {
        return this.match(types.colon) || superClass.prototype.shouldParseArrow.call(this);
      }

      shouldParseAsyncArrow(): boolean {
        return this.match(types.colon) || superClass.prototype.shouldParseAsyncArrow.call(this);
      }

      
}
  );
})!!;

plugins.estree = estreePlugin;
plugins.flow = flowPlugin;
plugins.jsx = jsxPlugin;
plugins.typescript = typescriptPlugin;
function parse(input: string, options?: Partial<ParserOptions>): Node {
  if (options && options.sourceType === "unambiguous") {
    options = Object.assign({}, options);

    try {
      options.sourceType = "module";
      var ast = getParser(options, input).parse(); // Rather than try to parse as a script first, we opt to parse as a module and convert back
      // to a script where possible to avoid having to do a full re-parse of the input content.

      if (!hasModuleSyntax(ast)) ast.program.sourceType = "script";
      return ast;
    } catch (moduleError) {
      try {
        options.sourceType = "script";
        return getParser(options, input).parse();
      } catch (scriptError) {}

      throw moduleError;
    }
  } else {
    return getParser(options, input).parse();
  }
}
function parseExpression(input: string, options?: Partial<ParserOptions>): Node {
  var parser = getParser(options, input);

  if (parser.options.strictMode) {
    parser.state.strict = true;
  }

  return parser.getExpression();
}
function getParser(options: Partial<ParserOptions> | undefined, input: string): Parser {
  var cls = options && options.plugins ? getParserClass(options.plugins) : Parser;
  return new cls(options, input);
}

var parserClassCache: Record<string, typeof Parser> = {};
/** Get a Parser class with plugins applied. */

function getParserClass(pluginsFromOptions: string[]): typeof Parser {
  if (pluginsFromOptions.indexOf("decorators") >= 0 && pluginsFromOptions.indexOf("decorators2") >= 0) {
    throw new Error("Cannot use decorators and decorators2 plugin together");
  } // Filter out just the plugins that have an actual mixin associated with them.


  var pluginList = pluginsFromOptions.filter(function (p) {
    return p === "estree" || p === "flow" || p === "jsx" || p === "typescript";
  });

  if (pluginList.indexOf("flow") >= 0) {
    // ensure flow plugin loads last
    pluginList = pluginList.filter(function (plugin) {
      return plugin !== "flow";
    });
    pluginList.push("flow");
  }

  if (pluginList.indexOf("flow") >= 0 && pluginList.indexOf("typescript") >= 0) {
    throw new Error("Cannot combine flow and typescript plugins.");
  }

  if (pluginList.indexOf("typescript") >= 0) {
    // ensure typescript plugin loads last
    pluginList = pluginList.filter(function (plugin) {
      return plugin !== "typescript";
    });
    pluginList.push("typescript");
  }

  if (pluginList.indexOf("estree") >= 0) {
    // ensure estree plugin loads first
    pluginList = pluginList.filter(function (plugin) {
      return plugin !== "estree";
    });
    pluginList.unshift("estree");
  }

  var key = pluginList.join("/");
  var cls = parserClassCache[key];

  if (!cls) {
    cls = Parser;

    for (var _i2 = 0, _pluginList2 = pluginList; _i2 < _pluginList2.length; _i2++) {
      var plugin = _pluginList2[_i2];
      cls = plugins[plugin](cls);
    }

    parserClassCache[key] = cls;
  }

  return cls;
}

function hasModuleSyntax(ast: Node): boolean {
  return nodeArray(ast.program.body).some(function (child) {
    return child.type === "ImportDeclaration" && (!child.importKind || child.importKind === "value") || child.type === "ExportNamedDeclaration" && (!child.exportKind || child.exportKind === "value") || child.type === "ExportAllDeclaration" && (!child.exportKind || child.exportKind === "value") || child.type === "ExportDefaultDeclaration";
  });
}







export {parse,parseExpression,Node,Parser};
