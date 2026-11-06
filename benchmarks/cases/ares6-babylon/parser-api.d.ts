/*
 * Copyright (C) 2012-2014 by various contributors (see AUTHORS)
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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


// Type declarations for upstream Babylon. Runtime methods stay on upstream prototypes.

export interface RegExpValue { pattern: string; flags: string; value?: NodeValue; }
export interface TemplateValue { raw: string; cooked: NodeValue; }
export type NodeValue = string | number | boolean | null | undefined | Node | RegExp | RegExpValue | TemplateValue;
export interface NodeExtra { [key: string]: NodeValue; raw?: string; rawValue?: NodeValue; parenthesized?: boolean; parenStart?: number; }
export interface TokenConfiguration { keyword?: string; beforeExpr?: boolean; startsExpr?: boolean; rightAssociative?: boolean; isLoop?: boolean; isAssign?: boolean; prefix?: boolean; postfix?: boolean; binop?: number; }
export interface Label { kind?: string | null; name?: string; statementStart?: number; }
export interface Comment { type: string; value: string; start: number; end: number; loc: SourceLocation; }
export interface StartReference { start: number; }
export interface FunctionTypeParameters { params: (Node | null)[]; rest: Node | null; }
export interface PositionedSyntaxError extends SyntaxError { pos?: number; loc?: Position; }
export interface ParserOptions {
  [key: string]: unknown;
  sourceType: string;
  sourceFilename: string | undefined;
  startLine: number;
  allowReturnOutsideFunction: boolean;
  allowImportExportEverywhere: boolean;
  allowSuperOutsideMethod: boolean;
  plugins: string[];
  strictMode: boolean | null;
  ranges: boolean;
}

export interface Position {
  line: number;
  column: number;

      
    }

export interface SourceLocation {
  start?: Position | SourceLocation | null;
  end: Position | SourceLocation | null | undefined;
  filename?: string;
  identifierName?: string | Node | null;

      
    }

export interface TokenType {
  label: string;
  keyword: string | undefined;
  beforeExpr: boolean;
  startsExpr: boolean;
  rightAssociative: boolean;
  isLoop: boolean;
  isAssign: boolean;
  prefix: boolean;
  postfix: boolean;
  binop: number | null;
  updateContext: ((this: Parser, previous: TokenType) => void) | null;

      
    }

export interface KeywordTokenType extends TokenType {
      
    }

export interface BinopTokenType extends TokenType {
      
    }

export interface TokContext {
  token: string;
  isExpr: boolean;
  preserveSpace: boolean;
  override: ((parser: Parser) => void) | undefined;

      

      //token: string;
      //isExpr: boolean;
      //preserveSpace: boolean;
      //override: ?Function;
    }

export interface State {
  [key: string]: unknown;
  strict: boolean;
  input: string;
  potentialArrowAt: number;
  inMethod: boolean | string | undefined;
  inFunction: boolean | undefined;
  inGenerator: boolean | undefined;
  inAsync: boolean | undefined;
  inPropertyName: boolean | undefined;
  inType: boolean;
  noAnonFunctionType: boolean;
  labels: Label[];
  decorators: Node[];
  tokens: (Token | Comment)[];
  comments: Comment[];
  trailingComments: Comment[];
  leadingComments: Comment[];
  commentStack: Node[];
  pos: number;
  lineStart: number;
  curLine: number;
  type: TokenType;
  value: NodeValue;
  start: number;
  end: number;
  startLoc: Position;
  endLoc: Position;
  lastTokEndLoc: Position | null;
  lastTokStartLoc: Position | null;
  lastTokStart: number;
  lastTokEnd: number;
  context: TokContext[];
  exprAllowed: boolean;
  containsEsc: boolean;
  containsOctal: boolean;
  octalPosition: number | null;
  invalidTemplateEscapePosition: number | null;
  exportedIdentifiers: string[];
  commentPreviousNode: Node | undefined;

      init(options: ParserOptions, input: string): State ;

      //// TODO
      //strict: boolean;

      //// TODO
      //input: string;

      //// Used to signify the start of a potential arrow function
      //potentialArrowAt: number;

      //// Flags to track whether we are in a function, a generator.
      //inFunction: boolean;
      //inGenerator: boolean;
      //inMethod: boolean;
      //inAsync: boolean;
      //inType: boolean;
      //inPropertyName: boolean;

      //// Labels in scope.
      //labels: Array<Object>;

      //// Leading decorators.
      //decorators: Array<Object>;

      //// Token store.
      //tokens: Array<Object>;

      //// Comment store.
      //comments: Array<Object>;

      //// Comment attachment store
      //trailingComments: Array<Object>;
      //leadingComments: Array<Object>;
      //commentStack: Array<Object>;

      //// The current position of the tokenizer in the input.
      //pos: number;
      //lineStart: number;
      //curLine: number;

      //// Properties of the current token:
      //// Its type
      //type: TokenType;

      //// For tokens that include more information than their type, the value
      //value: any;

      //// Its start and end offset
      //start: number;
      //end: number;

      //// And, if locations are used, the {line, column} object
      //// corresponding to those offsets
      //startLoc: Position | SourceLocation;
      //endLoc: Position;

      //// Position information for the previous token
      //lastTokEndLoc: ?Position;
      //lastTokStartLoc: ?Position;
      //lastTokStart: number;
      //lastTokEnd: number;

      //// The context stack is used to superficially track syntactic
      //// context to predict whether a regular expression is allowed in a
      //// given position.
      //context: Array<TokContext>;
      //exprAllowed: boolean;

      //// Used to signal to callers of `readWord1` whether the word
      //// contained any escape sequences. This is needed because words with
      //// escape sequences must not be interpreted as keywords.
      //containsEsc: boolean;

      //// TODO
      //containsOctal: boolean;
      //octalPosition: ?number;

      //// Names of exports store. `default` is stored as a name for both
      //// `export default foo;` and `export { foo as default };`.
      //exportedIdentifiers: Array<string>;

      curPosition(): Position ;

      clone(skipArrays?: boolean | undefined): State ;
    }

export interface Token {
  type: TokenType;
  value: NodeValue;
  start: number;
  end: number;
  loc: SourceLocation;

      
    }

export interface NodeBase {
  type: string;
  start?: number;
  end: number;
  loc: SourceLocation;
  range?: (number | undefined)[];
  body?: NodeDraft | Node[];
  value?: NodeValue;
  expression?: Node | boolean | null;
  extra?: NodeExtra | null;
  leadingComments?: Comment[] | null;
  trailingComments?: Comment[] | null;
  innerComments?: Comment[] | null;
  comments?: Comment[];
  tokens?: (Token | Comment)[];
  name?: string | Node | null;
  kind?: string | undefined;
  operator?: string;
  directive?: string;
  sourceType?: string;
  exportKind?: string;
  importKind?: string | null;
  raw?: string;
  pattern?: string;
  flags?: string;
  regex?: RegExpValue;
  computed?: boolean | undefined;
  async?: boolean | undefined;
  await?: boolean | undefined;
  generator?: boolean | undefined;
  delegate?: boolean | undefined;
  prefix?: boolean;
  method?: boolean;
  optional?: boolean;
  selfClosing?: boolean | undefined;
  shorthand?: boolean;
  static?: boolean | undefined;
  _exprListItem?: boolean;
  tail?: boolean;
  arguments?: (Node | null)[];
  attributes?: Node[];
  cases?: NodeDraft[];
  children?: Node[];
  declarations?: Node[];
  decorators?: Node[];
  directives?: Node[];
  elements?: (Node | null)[];
  expressions?: Node[];
  extends?: Node[];
  guardedHandlers?: Node[];
  implements?: Node[];
  mixins?: Node[];
  params?: (Node | null)[];
  properties?: Node[];
  quasis?: Node[];
  specifiers?: Node[];
  types?: Node[];
  argument?: Node | null;
  alternate?: Node | null;
  block?: Node;
  bound?: Node | null;
  callee?: Node;
  closingElement?: Node | null;
  declaration?: Node | null;
  discriminant?: Node;
  elementType?: Node;
  exported?: Node;
  finalizer?: Node | null;
  handler?: Node | null;
  id?: Node | null;
  imported?: Node;
  init?: Node | null;
  key?: Node;
  label?: Node | null;
  left?: Node;
  local?: Node;
  meta?: Node;
  namespace?: Node;
  object?: Node | null;
  openingElement?: Node;
  predicate?: Node | null;
  program?: Node;
  property?: Node;
  quasi?: Node;
  rest?: Node | null;
  returnType?: Node | null;
  right?: Node;
  source?: Node | null;
  superClass?: Node | null;
  superTypeParameters?: Node;
  tag?: Node;
  test?: Node | null;
  typeAnnotation?: Node | null;
  typeParameters?: Node | null;
  update?: Node | null;
  variance?: Node | null;
  consequent?: Node | Node[];
  indexers?: Node[];
  callProperties?: Node[];
  param?: Node | null;
  exact?: boolean | undefined;

      

      //type: string;
      //start: ?number;
      //end: number;
      //loc: SourceLocation;

      __clone(): NodeFields;
    }

export interface NodeFields extends NodeBase { [key: string]: unknown; }
export interface Parser {
  state: State;
  options: ParserOptions;
  inModule: boolean;
  input: string;
  plugins: Record<string, boolean>;
  filename: string | undefined;
  isLookahead?: boolean;
  jsx_readToken?: (this: Parser) => void;

next(this: Parser): void ;

eat(this: Parser, type: TokenType): boolean | undefined ;

match(this: Parser, type: TokenType): boolean ;

isKeyword(this: Parser, word: unknown): boolean ;

lookahead(this: Parser): State ;

setStrict(this: Parser, strict: boolean): void ;

curContext(this: Parser): TokContext ;

nextToken(this: Parser): void ;

readToken(this: Parser, code: number): void ;

fullCharCodeAtPos(this: Parser): number ;

pushComment(this: Parser, block: boolean, text: string, start: number, end: number, startLoc: Position | SourceLocation, endLoc: Position): void ;

skipBlockComment(this: Parser): void ;

skipLineComment(this: Parser, startSkip: number): void ;

skipSpace(this: Parser): void ;

finishToken(this: Parser, type: TokenType, val?: NodeValue): void ;

readToken_dot(this: Parser): void ;

readToken_slash(this: Parser): void ;

readToken_mult_modulo(this: Parser, code: number): void ;

readToken_pipe_amp(this: Parser, code: number): void ;

readToken_caret(this: Parser): void ;

readToken_plus_min(this: Parser, code: number): void ;

readToken_lt_gt(this: Parser, code: number): void ;

readToken_eq_excl(this: Parser, code: number): void ;

getTokenFromCode(this: Parser, code: number): void ;

finishOp(this: Parser, type: TokenType, size: number): void ;

readRegexp(this: Parser): void ;

readInt(this: Parser, radix: number, len?: number): number | null ;

readRadixNumber(this: Parser, radix: number): void ;

readNumber(this: Parser, startsWithDot: boolean | undefined): void ;

readCodePoint(this: Parser, throwOnInvalid: true): number;

readCodePoint(this: Parser, throwOnInvalid: false | undefined): number | null;

readCodePoint(this: Parser, throwOnInvalid: boolean | undefined): number | null;

readString(this: Parser, quote: number): void ;

readTmplToken(this: Parser): void ;

readEscapedChar(this: Parser, inTemplate: boolean | undefined): string | null ;

readHexChar(this: Parser, len: number, throwOnInvalid: true): number;

readHexChar(this: Parser, len: number, throwOnInvalid: false | undefined): number | null;

readHexChar(this: Parser, len: number, throwOnInvalid: boolean | undefined): number | null;

readWord1(this: Parser): string ;

readWord(this: Parser): void ;

braceIsBlock(this: Parser, prevType: TokenType): boolean ;

updateContext(this: Parser, prevType: TokenType): void ;



isReservedWord(word: unknown): boolean ;

hasPlugin(name: string): boolean ;

extend<K extends keyof this>(name: K, f: (inner: this[K]) => this[K]): void ;

loadPlugins(pluginList: string[]): Record<string, boolean>  ;

parse(): NodeOf<"File"> ;

addComment(comment: Comment): void ;

processComment(node: Node): void ;

checkPropClash(prop: NodeDraft, propHash: Record<string, boolean>): void ;

getExpression(): Node ;

parseExpression(noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node ;

parseMaybeAssign(noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined, afterLeftParse?: (this: Parser, node: Node, startPos: number, startLoc: Position | SourceLocation) => Node, refNeedsArrowPos?: StartReference | undefined): Node ;

parseMaybeConditional(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos: StartReference | undefined): Node ;

parseConditional(expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position | SourceLocation, refNeedsArrowPos?: StartReference | undefined): Node ;

parseExprOps(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node ;

parseExprOp(left: Node, leftStartPos: number, leftStartLoc: Position | SourceLocation, minPrec: number, noIn: boolean | undefined): Node ;

parseMaybeUnary(refShorthandDefaultPos?: StartReference | undefined): Node ;

parseExprSubscripts(refShorthandDefaultPos?: StartReference | undefined): Node ;

parseSubscripts(base: Node, startPos: number, startLoc: Position | SourceLocation, noCalls?: boolean | undefined): Node ;

parseCallExpressionArguments(close: TokenType, possibleAsyncArrow: boolean | undefined): (Node | null)[] ;

shouldParseAsyncArrow(): boolean ;

parseAsyncArrowFromCallExpression(node: NodeDraft, call: NodeOf<"CallExpression">): Node ;

parseNoCallExpr(): Node ;

parseExprAtom(refShorthandDefaultPos?: StartReference | undefined): Node ;

parseFunctionExpression(): Node ;

parseMetaProperty(node: NodeDraft, meta: Node, propertyName: string): NodeOf<"MetaProperty"> ;

parseLiteral(value: NodeValue, type: NodeKind, startPos?: number, startLoc?: Position | SourceLocation | null | undefined): Node ;

parseParenExpression(): Node ;

parseParenAndDistinguishExpression(startPos: number | null, startLoc: Position | SourceLocation | null, canBeArrow: boolean | undefined): Node ;

shouldParseArrow(): boolean ;

parseArrow(node: NodeDraft): NodeDraft | undefined ;

parseParenItem(node: Node, startPos?: number, startLoc?: Position | SourceLocation): Node ;

parseNew(): Node ;

parseTemplateElement(isTagged: boolean | undefined): Node ;

parseTemplate(isTagged: boolean | undefined): Node ;

parseObj(isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node ;

isGetterOrSetterMethod(prop: NodeDraft, isPattern: boolean | undefined): boolean | string | undefined ;

checkGetterSetterParamCount(method: NodeDraft): void ;

parseObjectMethod(prop: NodeDraft, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined): Node | undefined ;

parseObjectProperty(prop: NodeDraft, startPos: number | undefined, startLoc: Position | SourceLocation | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined ;

parseObjPropValue(prop: NodeDraft, startPos: number | undefined, startLoc: Position | SourceLocation | undefined, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined ;

parsePropertyName(prop: NodeDraft): Node ;

initFunction(node: NodeDraft, isAsync: boolean | undefined): void ;

parseMethod(node: NodeDraft, isGenerator?: boolean | undefined, isAsync?: boolean | undefined): NodeDraft ;

parseArrowExpression(node: NodeDraft, params: (Node | null)[], isAsync?: boolean | undefined): Node ;

isStrictBody(node: NodeDraft, isExpression: boolean | undefined): boolean ;

parseFunctionBody(node: NodeDraft, allowExpression?: boolean | undefined): void ;

parseExprList(close: TokenType, allowEmpty?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): (Node | null)[] ;

parseExprListItem(allowEmpty: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos?: StartReference | undefined): Node | null ;

parseIdentifier(liberal?: boolean | undefined, isBinding?: boolean | undefined): NodeOf<"Identifier"> ;

checkReservedWord(word: unknown, startLoc: number, checkKeywords: boolean | undefined, isBinding: boolean | undefined): void ;

parseAwait(node: NodeDraft): Node ;

parseYield(): Node ;

raise(pos: number, message: string): never ;

toAssignable<T extends Node | null>(node: T, isBinding: boolean | undefined, contextDescription: string): T extends null ? null : Node ;

toAssignableList(exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[] ;

toReferencedList(exprList: (Node | null)[]): (Node | null)[] ;

parseSpread(refShorthandDefaultPos: StartReference | undefined): Node ;

parseRest(): Node ;

shouldAllowYieldIdentifier(): boolean ;

parseBindingIdentifier(): Node ;

parseBindingAtom(): Node ;

parseBindingList(close: TokenType, allowEmpty?: boolean | undefined): (Node | null)[] ;

parseAssignableListItemTypes(param: Node): Node ;

parseMaybeDefault(startPos?: number, startLoc?: Position | SourceLocation | null | undefined, left?: Node): Node ;

checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void ;

startNode(): NodeDraft ;

startNodeAt(pos: number, loc: Position | SourceLocation | null | undefined): NodeDraft ;

finishNode<K extends NodeKind>(node: NodeDraft, type: K): NodeOf<K> ;

finishNodeAt<K extends NodeKind>(node: NodeDraft, type: K, pos: number, loc: Position | SourceLocation | null | undefined): NodeOf<K> ;

resetStartLocationFromNode<T extends NodeDraft>(node: T, locationNode: NodeDraft): T ;

parseTopLevel(file: NodeDraft, program: NodeDraft): NodeOf<"File"> ;

stmtToDirective(stmt: NodeOf<"ExpressionStatement">): NodeOf<"Directive"> ;

parseStatement(declaration: boolean | undefined, topLevel?: boolean | undefined): Node ;

takeDecorators(node: NodeDraft): void ;

parseDecorators(allowExport?: boolean | undefined): void ;

parseDecorator(): Node ;

parseBreakContinueStatement(node: NodeDraft, keyword: string | undefined): Node ;

parseDebuggerStatement(node: NodeDraft): Node ;

parseDoStatement(node: NodeDraft): Node ;

parseForStatement(node: NodeDraft): Node ;

parseFunctionStatement(node: NodeDraft): Node ;

parseIfStatement(node: NodeDraft): Node ;

parseReturnStatement(node: NodeDraft): Node ;

parseSwitchStatement(node: NodeDraft): Node ;

parseThrowStatement(node: NodeDraft): Node ;

parseTryStatement(node: NodeDraft): Node ;

parseVarStatement(node: NodeDraft, kind: TokenType): Node ;

parseWhileStatement(node: NodeDraft): Node ;

parseWithStatement(node: NodeDraft): Node ;

parseEmptyStatement(node: NodeDraft): Node ;

parseLabeledStatement(node: NodeDraft, maybeName: string, expr: Node): Node ;

parseExpressionStatement(node: NodeDraft, expr: Node): Node ;

parseBlock(allowDirectives?: boolean | undefined, _topLevel?: boolean): NodeOf<"BlockStatement"> ;

isValidDirective(stmt: Node): boolean ;

parseBlockBody(node: NodeDraft, allowDirectives: boolean | undefined, topLevel: boolean | undefined, end: TokenType): void ;

parseFor(node: NodeDraft, init: Node | null): Node ;

parseForIn(node: NodeDraft, init: Node, forAwait: boolean | undefined): Node ;

parseVar(node: NodeDraft, isFor: boolean | undefined, kind: TokenType): NodeDraft ;

parseVarHead(decl: NodeDraft): void ;

parseFunction(node: NodeDraft, isStatement: boolean | number, allowExpressionBody?: boolean | undefined, isAsync?: boolean | undefined, optionalId?: boolean | undefined): Node ;

parseFunctionParams(node: NodeDraft): void ;

parseClass(node: NodeDraft, isStatement: boolean | number, optionalId?: boolean | undefined): Node ;

isClassProperty(): boolean ;

isClassMethod(): boolean ;

isNonstaticConstructor(method: NodeDraft): boolean ;

parseClassBody(node: NodeDraft): void ;

parseClassProperty(node: NodeDraft): Node ;

parseClassMethod(classBody: NodeDraft, method: NodeDraft, isGenerator: boolean | undefined, isAsync: boolean | undefined): void ;

parseClassId(node: NodeDraft, isStatement: boolean | number, optionalId: boolean | undefined): void ;

parseClassSuper(node: NodeDraft, isStatement?: boolean | undefined): void ;

parseExport(node: NodeDraft): Node ;

parseExportDeclaration(node: NodeDraft): Node | null ;

isExportDefaultSpecifier(): boolean ;

parseExportSpecifiersMaybe(node: NodeDraft): void ;

parseExportFrom(node: NodeDraft, expect?: boolean | undefined): void ;

shouldParseExportDeclaration(): boolean ;

checkExport(node: NodeDraft, checkNames?: boolean | undefined, isDefault?: boolean | undefined): void ;

checkDeclaration(node: Node): void ;

checkDuplicateExports(node: NodeDraft, name: string): void ;

raiseDuplicateExportError(node: NodeDraft, name: string): never ;

parseExportSpecifiers(): Node[] ;

parseImport(node: NodeDraft): Node ;

parseImportSpecifiers(node: NodeDraft): void ;

parseImportSpecifier(node: NodeDraft): void ;

parseImportSpecifierDefault(id: Node, startPos: number, startLoc: Position | SourceLocation): Node ;

addExtra(node: NodeDraft, key: string, val: NodeValue): void ;

isRelational(op: string): boolean ;

expectRelational(op: string): void ;

isContextual(name: string): boolean ;

eatContextual(name: string): boolean | undefined ;

expectContextual(name: string, message?: string): void ;

canInsertSemicolon(): boolean ;

isLineTerminator(): boolean | undefined ;

semicolon(): void ;

expect(type: TokenType, pos?: number | null): boolean ;

unexpected(pos?: number | null, messageOrType?: string | TokenType): never ;

estreeParseRegExpLiteral({ pattern, flags }: RegExpValue): Node ;

estreeParseLiteral(value: NodeValue): Node ;

directiveToStmt(directive: NodeOf<"Directive">): NodeOf<"ExpressionStatement"> ;

flowParseTypeInitialiser(tok?: TokenType): Node ;

flowParsePredicate(): Node ;

flowParseTypeAndPredicateInitialiser(): [Node | null, Node | null] ;

flowParseDeclareClass(node: NodeDraft): Node ;

flowParseDeclareFunction(node: NodeDraft): Node ;

flowParseDeclare(node: NodeDraft, _allowDefault?: boolean): Node ;

flowParseDeclareVariable(node: NodeDraft): Node ;

flowParseDeclareModule(node: NodeDraft): Node ;

flowParseDeclareModuleExports(node: NodeDraft): Node ;

flowParseDeclareTypeAlias(node: NodeDraft): Node ;

flowParseDeclareInterface(node: NodeDraft): Node ;

flowParseInterfaceish(node: NodeDraft, allowStatic?: boolean | undefined): void ;

flowParseInterfaceExtends(): Node ;

flowParseInterface(node: NodeDraft): Node ;

flowParseRestrictedIdentifier(liberal?: boolean | undefined): Node ;

flowParseTypeAlias(node: NodeDraft, allowDefault?: unknown): Node ;

flowParseTypeParameter(): Node ;

flowParseTypeParameterDeclaration(): Node ;

flowParseTypeParameterInstantiation(): Node ;

flowParseObjectPropertyKey(): Node ;

flowParseObjectTypeIndexer(node: NodeDraft, isStatic: boolean | undefined, variance: Node | null): Node ;

flowParseObjectTypeMethodish(node: NodeDraft): Node ;

flowParseObjectTypeMethod(startPos: number, startLoc: Position | SourceLocation, isStatic: boolean | undefined, key: Node): Node ;

flowParseObjectTypeCallProperty(node: NodeDraft, isStatic: boolean | undefined): Node ;

flowParseObjectType(allowStatic: boolean | undefined, allowExact?: boolean | undefined): Node ;

flowObjectTypeSemicolon(): void ;

flowParseQualifiedTypeIdentifier(startPos?: number, startLoc?: Position | SourceLocation, id?: Node): Node ;

flowParseGenericType(startPos: number, startLoc: Position | SourceLocation, id: Node): Node ;

flowParseTypeofType(): Node ;

flowParseTupleType(): Node ;

flowParseFunctionTypeParam(): Node ;

reinterpretTypeAsFunctionTypeParam(type: Node): Node ;

flowParseFunctionTypeParams(params?: (Node | null)[]): FunctionTypeParameters ;

flowIdentToTypeAnnotation(startPos: number, startLoc: Position | SourceLocation, node: NodeDraft, id: Node): Node ;

flowParsePrimaryType(): Node ;

flowParsePostfixType(): Node ;

flowParsePrefixType(): Node ;

flowParseAnonFunctionWithoutParens(): Node ;

flowParseIntersectionType(): Node ;

flowParseUnionType(): Node ;

flowParseType(): Node ;

flowParseTypeAnnotation(): Node ;

flowParseTypeAndPredicateAnnotation(): Node ;

flowParseTypeAnnotatableIdentifier(): Node ;

typeCastToParameter(node: NodeOf<"TypeCastExpression">): Node ;

flowParseVariance(): Node | null ;

jsxReadToken(): void ;

jsxReadNewLine(normalizeCRLF: boolean | undefined): string ;

jsxReadString(quote: number): void ;

jsxReadEntity(): string ;

jsxReadWord(): void ;

jsxParseIdentifier(): NodeOf<"JSXIdentifier"> ;

jsxParseNamespacedName(): JSXName ;

jsxParseElementName(): JSXName ;

jsxParseAttributeValue(): Node ;

jsxParseEmptyExpression(): Node ;

jsxParseSpreadChild(): Node ;

jsxParseExpressionContainer(): NodeOf<"JSXExpressionContainer"> ;

jsxParseAttribute(): Node ;

jsxParseOpeningElementAt(startPos: number, startLoc: Position | SourceLocation): NodeOf<"JSXOpeningElement"> ;

jsxParseClosingElementAt(startPos: number, startLoc: Position | SourceLocation): NodeOf<"JSXClosingElement"> ;

jsxParseElementAt(startPos: number, startLoc: Position | SourceLocation): NodeOf<"JSXElement"> ;

jsxParseElement(): NodeOf<"JSXElement"> ;
}

export interface StateDraft {
  [key: string]: unknown;
  strict?: boolean;
  input?: string;
  potentialArrowAt?: number;
  inMethod?: boolean | string | undefined;
  inFunction?: boolean | undefined;
  inGenerator?: boolean | undefined;
  inAsync?: boolean | undefined;
  inPropertyName?: boolean | undefined;
  inType?: boolean;
  noAnonFunctionType?: boolean;
  labels?: Label[];
  decorators?: Node[];
  tokens?: (Token | Comment)[];
  comments?: Comment[];
  trailingComments?: Comment[];
  leadingComments?: Comment[];
  commentStack?: Node[];
  pos?: number;
  lineStart?: number;
  curLine?: number;
  type?: TokenType;
  value?: NodeValue;
  start?: number;
  end?: number;
  startLoc?: Position;
  endLoc?: Position;
  lastTokEndLoc?: Position | null;
  lastTokStartLoc?: Position | null;
  lastTokStart?: number;
  lastTokEnd?: number;
  context?: TokContext[];
  exprAllowed?: boolean;
  containsEsc?: boolean;
  containsOctal?: boolean;
  octalPosition?: number | null;
  invalidTemplateEscapePosition?: number | null;
  exportedIdentifiers?: string[];
  commentPreviousNode?: Node | undefined;
      init(options: ParserOptions, input: string): State ;
      curPosition(): Position ;
      clone(skipArrays?: boolean | undefined): State ;
}
// Upstream builds a node before finishNode assigns its grammar kind. The
// field bag describes that mutable draft; completed nodes refine it by kind.
export type NodeKind = "AnyTypeAnnotation" | "ArrayExpression" | "ArrayPattern" | "ArrayTypeAnnotation" | "ArrowFunctionExpression" | "AssignmentExpression" | "AssignmentPattern" | "AwaitExpression" | "BinaryExpression" | "BindExpression" | "Binding" | "BlockStatement" | "BooleanLiteral" | "BooleanLiteralTypeAnnotation" | "BooleanTypeAnnotation" | "BreakStatement" | "CallExpression" | "CatchClause" | "ClassBody" | "ClassDeclaration" | "ClassExpression" | "ClassImplements" | "ClassMethod" | "ClassProperty" | "CommentBlock" | "CommentLine" | "ConditionalExpression" | "ContinueStatement" | "DebuggerStatement" | "DeclareClass" | "DeclareFunction" | "DeclareInterface" | "DeclareModule" | "DeclareModuleExports" | "DeclareTypeAlias" | "DeclareVariable" | "DeclaredPredicate" | "Decorator" | "Directive" | "DirectiveLiteral" | "DoExpression" | "DoWhileStatement" | "EmptyStatement" | "EmptyTypeAnnotation" | "ExistsTypeAnnotation" | "ExportAllDeclaration" | "ExportDefaultDeclaration" | "ExportDefaultSpecifier" | "ExportNamedDeclaration" | "ExportNamespaceSpecifier" | "ExportSpecifier" | "ExpressionStatement" | "File" | "ForInStatement" | "ForOfStatement" | "ForStatement" | "FunctionDeclaration" | "FunctionExpression" | "FunctionTypeAnnotation" | "FunctionTypeParam" | "GenericTypeAnnotation" | "Identifier" | "IfStatement" | "Import" | "ImportDeclaration" | "ImportDefaultSpecifier" | "ImportNamespaceSpecifier" | "ImportSpecifier" | "InferredPredicate" | "InterfaceDeclaration" | "InterfaceExtends" | "IntersectionTypeAnnotation" | "Invalid" | "JSXAttribute" | "JSXClosingElement" | "JSXElement" | "JSXEmptyExpression" | "JSXExpressionContainer" | "JSXIdentifier" | "JSXMemberExpression" | "JSXNamespacedName" | "JSXOpeningElement" | "JSXSpreadAttribute" | "JSXSpreadChild" | "JSXText" | "LabeledStatement" | "Literal" | "LogicalExpression" | "MemberExpression" | "MetaProperty" | "MethodDefinition" | "MixedTypeAnnotation" | "NewExpression" | "NullLiteral" | "NullLiteralTypeAnnotation" | "NullableTypeAnnotation" | "NumberLiteralTypeAnnotation" | "NumberTypeAnnotation" | "NumericLiteral" | "ObjectExpression" | "ObjectMethod" | "ObjectPattern" | "ObjectProperty" | "ObjectTypeAnnotation" | "ObjectTypeCallProperty" | "ObjectTypeIndexer" | "ObjectTypeProperty" | "Program" | "Property" | "QualifiedTypeIdentifier" | "RegExpLiteral" | "RestElement" | "ReturnStatement" | "SequenceExpression" | "Software" | "SpreadElement" | "StringLiteral" | "StringLiteralTypeAnnotation" | "StringTypeAnnotation" | "Super" | "SwitchCase" | "SwitchStatement" | "TaggedTemplateExpression" | "TemplateElement" | "TemplateLiteral" | "ThisExpression" | "ThisTypeAnnotation" | "ThrowStatement" | "TryStatement" | "TupleTypeAnnotation" | "TypeAlias" | "TypeAnnotation" | "TypeCastExpression" | "TypeParameter" | "TypeParameterDeclaration" | "TypeParameterInstantiation" | "TypeofTypeAnnotation" | "UnaryExpression" | "UnionTypeAnnotation" | "UpdateExpression" | "VariableDeclaration" | "VariableDeclarator" | "Variance" | "VoidTypeAnnotation" | "WhileStatement" | "WithStatement" | "YieldExpression";
export type NodeDraft = NodeFields & { start: number };
export interface NodeShapes {
  File: { program: NodeOf<"Program">; comments: Comment[]; tokens: (Token | Comment)[] };
  Identifier: { name: string };
  JSXIdentifier: { name: string };
  StringLiteral: { value: string };
  NumericLiteral: { value: number };
  BooleanLiteral: { value: boolean };
  NullLiteral: { };
  RegExpLiteral: { value: RegExp | null; pattern?: string; flags?: string };
  Literal: { value: string | number | boolean | null | RegExp; regex?: RegExpValue };
  DirectiveLiteral: { value: string; extra: NodeExtra & { raw: string; rawValue: string } };
  Directive: { value: NodeOf<"DirectiveLiteral"> };
  Program: { body: Node[]; directives?: NodeOf<"Directive">[]; sourceType: string };
  BlockStatement: { body: Node[]; directives?: NodeOf<"Directive">[] };
  ClassBody: { body: Node[] };
  ExpressionStatement: { expression: Node };
  VariableDeclarator: { id: Node; init: Node | null };
  VariableDeclaration: { declarations: NodeOf<"VariableDeclarator">[]; kind: string };
  FunctionDeclaration: { id: Node | null; params: (Node | null)[]; body: Node; generator: boolean; async: boolean };
  FunctionExpression: { id: Node | null; params: (Node | null)[]; body: Node; generator: boolean; async: boolean };
  ArrowFunctionExpression: { params: (Node | null)[]; body: Node; expression: boolean; generator: boolean; async: boolean };
  ObjectMethod: { key: Node; params?: (Node | null)[]; body?: Node; value?: NodeOf<"FunctionExpression">; kind: string; computed: boolean };
  ClassMethod: { key: Node; params?: (Node | null)[]; body?: Node; value?: NodeOf<"FunctionExpression">; kind: string; computed: boolean };
  MethodDefinition: { key: Node; value: Node; kind: string; computed: boolean };
  ObjectProperty: { key: Node; value: Node; computed: boolean; shorthand?: boolean };
  Property: { key: Node; value: Node; kind: string; computed: boolean; shorthand?: boolean };
  ObjectPattern: { properties: Node[] };
  ObjectExpression: { properties: Node[] };
  ArrayPattern: { elements: (Node | null)[] };
  ArrayExpression: { elements: (Node | null)[] };
  ReturnStatement: { argument: Node | null };
  SpreadElement: { argument: Node };
  RestElement: { argument: Node };
  SpreadProperty: { argument: Node };
  RestProperty: { argument: Node };
  AssignmentExpression: { left: Node; right: Node; operator: string };
  AssignmentPattern: { left: Node; right: Node };
  UnaryExpression: { argument: Node; operator: string };
  UpdateExpression: { argument: Node; operator: string };
  BinaryExpression: { left: Node; right: Node; operator: string };
  LogicalExpression: { left: Node; right: Node; operator: string };
  TypeCastExpression: { expression: Node; typeAnnotation: Node };
  TemplateElement: { value: { raw: string; cooked: string | null }; tail: boolean };
  TemplateLiteral: { quasis: Node[]; expressions: Node[] };
  MetaProperty: { meta: Node; property: Node };
  MemberExpression: { object: Node; property: Node; computed: boolean };
  ExportDefaultDeclaration: { declaration: Node };
  ExportNamedDeclaration: { declaration: Node | null; specifiers: Node[]; source: Node | null };
  ClassDeclaration: { id: Node | null; superClass: Node | null; body: NodeOf<"ClassBody"> };
  ClassExpression: { id: Node | null; superClass: Node | null; body: NodeOf<"ClassBody"> };
  ImportDeclaration: { specifiers: Node[]; source: Node };
  CatchClause: { param: Node | null; body: NodeOf<"BlockStatement"> };
  SwitchCase: { consequent: Node[]; test: Node | null };
  SwitchStatement: { discriminant: Node; cases: NodeOf<"SwitchCase">[] };
  CallExpression: { callee: Node; arguments: (Node | null)[] };
  NewExpression: { callee: Node; arguments: (Node | null)[] };
  JSXExpressionContainer: { expression: Node };
  JSXElement: { openingElement: Node; closingElement: Node | null; children: Node[] };
  JSXOpeningElement: { attributes: Node[]; name: JSXName; selfClosing: boolean };
  JSXClosingElement: { name: JSXName };
  JSXMemberExpression: { object: JSXName; property: NodeOf<"JSXIdentifier"> };
  JSXNamespacedName: { namespace: NodeOf<"JSXIdentifier">; name: NodeOf<"JSXIdentifier"> };
  JSXText: { value: string };
  ExportSpecifier: { local: NodeOf<"Identifier">; exported: NodeOf<"Identifier"> };
  ExportDefaultSpecifier: { exported: NodeOf<"Identifier"> };
  ExportNamespaceSpecifier: { exported: NodeOf<"Identifier"> };
  ImportSpecifier: { local: NodeOf<"Identifier">; imported: NodeOf<"Identifier"> };
  ImportDefaultSpecifier: { local: NodeOf<"Identifier"> };
  ImportNamespaceSpecifier: { local: NodeOf<"Identifier"> };
  TypeParameter: { name: string };
}
export type NodeOf<K extends NodeKind> = K extends NodeKind ? Omit<NodeBase, keyof (K extends keyof NodeShapes ? NodeShapes[K] : {}) | "type" | "start" | "end" | "loc" | "__clone"> & { [key: string]: unknown; __clone(): NodeOf<K> } & { type: K; start: number; end: number; loc: SourceLocation } & (K extends keyof NodeShapes ? NodeShapes[K] : unknown) : never;
export type Node = { [K in NodeKind]: NodeOf<K> }[NodeKind];

export type JSXName = NodeOf<"JSXIdentifier" | "JSXNamespacedName" | "JSXMemberExpression">;

export interface ParserConstructor { new(options: Partial<ParserOptions> | undefined, input: string): Parser; plugins?: Record<string, (instance: Parser) => void>; prototype: Partial<Parser>; }
export interface InstalledParserConstructor extends ParserConstructor { plugins: Record<string, (instance: Parser) => void>; }
export type Empty = Record<string, never>;
export type Predicate = (word: unknown) => boolean;
export interface IdentifierModule { reservedWords: { 6: Predicate; strict: Predicate; strictBind: Predicate }; isKeyword: Predicate; isIdentifierStart: (code: number, _astral?: boolean) => boolean | undefined; isIdentifierChar: (code: number, _astral?: boolean) => boolean | undefined; }
export interface WhitespaceModule { lineBreak: RegExp; lineBreakG: RegExp; isNewLine: (code: number, _astral?: boolean) => boolean | undefined; nonASCIIwhitespace: RegExp; }
export interface LocationModule { Position: new(line: number, column: number) => Position; SourceLocation: new(start: Position | SourceLocation | null | undefined, end?: Position | null) => SourceLocation; getLineInfo: (input: string, offset: number) => Position; }
export interface TokenTypesModule { TokenType: new(label: string, configuration?: TokenConfiguration) => TokenType; BinopTokenType: new(name: string, precedence: number) => BinopTokenType; types: Record<string, TokenType>; keywords: Record<string, TokenType>; }
export interface ContextModule { TokContext: new(token: string, isExpr: boolean, preserveSpace?: boolean, override?: (parser: Parser) => void) => TokContext; types: Record<string, TokContext>; }
export interface StateConstructor { new(): StateDraft; prototype: Pick<StateDraft, "init" | "clone" | "curPosition">; }
export interface TokenizerConstructor { new(options: ParserOptions, input: string): Tokenizer; prototype: Partial<Tokenizer>; Token?: new(state: State) => Token; }
export interface OptionsModule { defaultOptions: ParserOptions; getOptions: (options?: Partial<ParserOptions>) => ParserOptions; }
export type OptionValue = ParserOptions[keyof ParserOptions];
export type Plugin = (instance: Parser) => void;

// During module installation the class exists, while later prototype methods
// have yet to be attached. No fully installed instance is asserted here.
export interface ParserAssembly<K extends keyof Parser = never> { prototype: Partial<Parser> & Pick<Parser, K>; plugins?: Record<string, Plugin>; }

// Function.apply accepts the original arguments object for exact forwarding.
export interface ApplyForwarder<R> { apply(thisArg: Parser, args: IArguments): R; }

export type StatePosition = Pick<State, "curLine" | "pos" | "lineStart" | "curPosition">;
export type TokenizerDraft = Omit<Tokenizer, "state"> & { state: StateDraft };

export interface Tokenizer { state: State; isLookahead?: boolean;
next(this: Parser): void ;
eat(this: Parser, type: TokenType): boolean | undefined ;
match(this: Parser, type: TokenType): boolean ;
isKeyword(this: Parser, word: unknown): boolean ;
lookahead(this: Parser): State ;
setStrict(this: Parser, strict: boolean): void ;
curContext(this: Parser): TokContext ;
nextToken(this: Parser): void ;
readToken(this: Parser, code: number): void ;
fullCharCodeAtPos(this: Parser): number ;
pushComment(this: Parser, block: boolean, text: string, start: number, end: number, startLoc: Position | SourceLocation, endLoc: Position): void ;
skipBlockComment(this: Parser): void ;
skipLineComment(this: Parser, startSkip: number): void ;
skipSpace(this: Parser): void ;
finishToken(this: Parser, type: TokenType, val?: NodeValue): void ;
readToken_dot(this: Parser): void ;
readToken_slash(this: Parser): void ;
readToken_mult_modulo(this: Parser, code: number): void ;
readToken_pipe_amp(this: Parser, code: number): void ;
readToken_caret(this: Parser): void ;
readToken_plus_min(this: Parser, code: number): void ;
readToken_lt_gt(this: Parser, code: number): void ;
readToken_eq_excl(this: Parser, code: number): void ;
getTokenFromCode(this: Parser, code: number): void ;
finishOp(this: Parser, type: TokenType, size: number): void ;
readRegexp(this: Parser): void ;
readInt(this: Parser, radix: number, len?: number): number | null ;
readRadixNumber(this: Parser, radix: number): void ;
readNumber(this: Parser, startsWithDot: boolean | undefined): void ;
readCodePoint(this: Parser, throwOnInvalid: true): number;
readCodePoint(this: Parser, throwOnInvalid: false | undefined): number | null;
readCodePoint(this: Parser, throwOnInvalid: boolean | undefined): number | null;
readString(this: Parser, quote: number): void ;
readTmplToken(this: Parser): void ;
readEscapedChar(this: Parser, inTemplate: boolean | undefined): string | null ;
readHexChar(this: Parser, len: number, throwOnInvalid: true): number;
readHexChar(this: Parser, len: number, throwOnInvalid: false | undefined): number | null;
readHexChar(this: Parser, len: number, throwOnInvalid: boolean | undefined): number | null;
readWord1(this: Parser): string ;
readWord(this: Parser): void ;
braceIsBlock(this: Parser, prevType: TokenType): boolean ;
updateContext(this: Parser, prevType: TokenType): void ;
}
