#!/usr/bin/env python3
"""DOM bindings for compiled TypeScript, generated from Blink's own IDL.

Reads the resolved IDL database Blink's build writes
(gen/third_party/blink/renderer/bindings/web_idl_database.pickle) with Blink's
own `web_idl` module, and asks Blink's own binding generator (`bind_gen`) for
the C++ expression that implements each member -- the receiver, `[Reflect]`
accessors, `[ImplementedAs]`, partial interfaces and mixins, `[CallWith]`,
which members take an ExceptionState -- so that what a compiled program calls
is what page script calls, decided by the same code.

Emits, for the allowlisted interfaces:

  native/ffi/dom_idl.h    the C ABI: one function per member and arity
  native/dom_idl.cc       the adapter: each function, Blink's call
  types/dom-idl.d.ts      module "nts:dom", as a program writes it

and `bindgen/report.json`: every member skipped, with why. A member whose
types this generator does not map is skipped and listed, never guessed.

The surface is the one `nts bind-gir` gives GTK, GJS's: an interface is a
`HostClass` handle intersected with its methods, by IDL inheritance; an
operation is a method (`el.setAttribute("class", c)`), an attribute a
property read and written through two methods (`el.className = c`, by
`@ntsGet`/`@ntsSet`). A member Blink marks as raising (`[RaisesException]`)
takes an `@ntsThrows` slot, so its DOM exception is thrown in the program as
in page script; no other member pays for one. A node is its Blink address;
text crosses as a `StringView` both ways. Every function runs inside an entry,
whose context the adapter finds itself (nts_dom::Current): the receiver is the
first argument, as a method's must be.

What page script's binding decides, this one decides the same way, from the
same code: the C++ call (`_make_blink_api_call`), whether it may throw, the
`[CEReactions]` scope, and which arities exist -- an optional argument with
no default truncates the call where it is missing, one with a default is
passed it.

  python3 tooling/chromium/bindgen/generate.py            # write
  python3 tooling/chromium/bindgen/generate.py --check    # compare
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SRC = os.path.join(ROOT, "third_party", "chromium", "src")
SCRIPTS = os.path.join(SRC, "third_party", "blink", "renderer", "bindings", "scripts")
LANE = os.path.join(ROOT, "runtime", "chromium", "experiments", "native-bootstrap")
DATABASE = os.path.join(SRC, "out", "NtsPerf", "gen", "third_party", "blink", "renderer", "bindings",
                        "web_idl_database.pickle")
ALLOWLIST = os.path.join(os.path.dirname(__file__), "allowlist.json")

sys.path.insert(0, SCRIPTS)
sys.path.insert(0, os.path.join(SRC, "third_party", "pyjson5", "src"))

import web_idl  # noqa: E402
import bind_gen  # noqa: E402
from bind_gen import interface as bind_interface  # noqa: E402
from bind_gen import name_style  # noqa: E402
from bind_gen.blink_v8_bridge import blink_class_name, blink_type_info  # noqa: E402
from bind_gen.code_node import SymbolScopeNode  # noqa: E402
from bind_gen.codegen_context import CodeGenContext  # noqa: E402
from bind_gen.path_manager import PathManager  # noqa: E402


class Skip(Exception):
    """A member this generator does not bind yet, and why."""


# What crosses as a number or a boolean: the IDL type, the C type, the
# TypeScript type. A number is a plain `number` the compiler converts at the
# call (`CNumber`), as a GTK binding's `gint` is: `input.maxLength = 5`.
SCALARS = {
    "boolean": ("bool", "boolean"),
    "byte": ("int8_t", 'CNumber<"int8">'),
    "octet": ("uint8_t", 'CNumber<"uint8">'),
    "short": ("int16_t", 'CNumber<"int16">'),
    "unsigned short": ("uint16_t", 'CNumber<"uint16">'),
    "long": ("int32_t", 'CNumber<"int32">'),
    "unsigned long": ("uint32_t", 'CNumber<"uint32">'),
    "long long": ("int64_t", 'CNumber<"int64">'),
    "unsigned long long": ("uint64_t", 'CNumber<"uint64">'),
    "float": ("float", 'CNumber<"float">'),
    "unrestricted float": ("float", 'CNumber<"float">'),
    "double": ("double", "number"),
    "unrestricted double": ("double", "number"),
}
# DOMString and CSSOMString are one type to Blink. A USVString's lone
# surrogates become U+FFFD, as V8's conversion makes them. A ByteString
# throws on a unit above 0xFF, which no program string is checked for yet.
STRINGS = {"DOMString", "CSSOMString", "USVString"}

# Words a parameter cannot be named in TypeScript or C++, and the one the
# error slot takes.
RESERVED = set("""
    break case catch class const continue debugger default delete do else enum
    export extends false finally for function if import in instanceof new null
    return super switch this throw true try typeof var void while with let
    static yield await implements interface package private protected public
    char int long short float double signed unsigned auto register template
    operator namespace bool union struct error context receiver
""".split())

THROWS = ("@ntsThrows error nts_dom_exception_take_message", "@ntsNoEscape error")
ERROR_TS = "error?: Ptr<DOMException | null>"
ERROR_C = "NtsDomException** error"


class Param:
    def __init__(self, name, c, ts, expr, context, include=None):
        self.name, self.c, self.ts, self.expr = name, c, ts, expr
        self.context = context  # whether converting it needs the context
        self.include = include


class Result:
    def __init__(self, c, ts, kind, nullable=False):
        self.c, self.ts, self.kind, self.nullable = c, ts, kind, nullable


class Function:
    """One C function: a getter, a setter, or one arity of an operation."""

    def __init__(self, interface, symbol, params, result, expression, throws, reactions):
        self.interface, self.symbol, self.params, self.result = interface, symbol, params, result
        self.expression, self.throws, self.reactions = expression, throws, reactions

    def needs_context(self):
        return (self.reactions or self.result.kind == "string" or any(p.context for p in self.params)
                or "context." in self.expression)


class Generator:
    def __init__(self, database, allowlist):
        self.database = database
        self.allowlist = allowlist
        self.interfaces = [database.find(name) for name in allowlist["interfaces"]]
        self.bound = {interface.identifier for interface in self.interfaces}
        self.skipped = []
        self.functions = []
        self.members = {}  # interface identifier -> TypeScript member lines
        self.headers = set()

    # -- types -----------------------------------------------------------

    @staticmethod
    def handle_tag(identifier):
        return "NtsDom" + identifier

    def bound_interface(self, idl_type):
        definition = idl_type.unwrap(nullable=True).type_definition_object
        if definition.identifier not in self.bound:
            raise Skip(f"interface {definition.identifier} is not bound")
        return definition

    def node(self, interface, name):
        """The Blink object behind a handle, which the handle's type names:
        a handle is the object as a ScriptWrappable (dom_context.h), so the
        conversion is a static_cast from there, NULL to NULL."""
        return f"ObjectOf<blink::{blink_class_name(interface)}>({name})"

    def ancestors(self, interface):
        chain = []
        inherited = interface.inherited
        while inherited is not None:
            chain.append(inherited.identifier)
            inherited = inherited.inherited
        return chain

    def hierarchy_root(self, interface):
        """The bound interface a handle family starts from: an interface with
        no bound ancestor is one."""
        root = interface
        for identifier in self.ancestors(interface):
            if identifier in self.bound:
                root = self.database.find(identifier)
        return root

    @staticmethod
    def safe(name):
        return name + "_" if name in RESERVED else name

    def parameter(self, idl_type, identifier):
        name = self.safe(identifier)
        nullable = idl_type.does_include_nullable_type
        unwrapped = idl_type.unwrap(nullable=True)
        or_null = " | null" if nullable else ""
        if unwrapped.is_interface:
            interface = self.bound_interface(idl_type)
            expr = self.node(interface, name)
            return Param(name, f"{self.handle_tag(interface.identifier)}* {name}",
                         f"{name}: {interface.identifier}{or_null}", expr, False)
        if unwrapped.is_union:
            strings = [t for t in unwrapped.flattened_member_types
                       if t.unwrap().keyword_typename in STRINGS]
            if len(strings) != 1:
                raise Skip(f"parameter type {idl_type.syntactic_form}")
            union = blink_type_info(unwrapped).typename
            expr = f"blink::MakeGarbageCollected<blink::{union}>(blink::String({self.text(strings[0], name)}))"
            if nullable:
                expr = f"({name} ? {expr} : nullptr)"
            return Param(name, f"const NtsBorrowedString* {name}", f"{name}: StringView{or_null}", expr, True,
                         PathManager(unwrapped.union_definition_object).api_path(ext="h"))
        keyword = unwrapped.keyword_typename
        if keyword in STRINGS:
            return Param(name, f"const NtsBorrowedString* {name}", f"{name}: StringView{or_null}",
                         self.text(unwrapped, name), True)
        if keyword in SCALARS and not nullable:
            c, ts = SCALARS[keyword]
            return Param(name, f"{c} {name}", f"{name}: {ts}", name, False)
        raise Skip(f"parameter type {idl_type.syntactic_form}")

    @staticmethod
    def text(idl_type, name):
        if idl_type.unwrap().keyword_typename == "USVString":
            return f"NtsText(context, {name}, /*scalar_values=*/true)"
        return f"NtsText(context, {name})"

    def result(self, idl_type):
        if idl_type.is_undefined:
            return Result("void", "void", "void")
        nullable = idl_type.does_include_nullable_type
        unwrapped = idl_type.unwrap(nullable=True)
        or_null = " | null" if nullable else ""
        if unwrapped.is_interface:
            interface = self.bound_interface(idl_type)
            return Result(f"{self.handle_tag(interface.identifier)}*", interface.identifier + or_null, "node")
        keyword = unwrapped.keyword_typename
        if keyword in STRINGS:
            return Result("const NtsStringView*", "StringView" + or_null, "string", nullable)
        # `(DOMString or TrustedScript)?`: Blink's implementation answers the
        # string (`textContentForBinding` is a `String`), and nts_dom::AsString
        # CHECKs that a union it does answer holds its string.
        if unwrapped.is_union and sum(1 for t in unwrapped.flattened_member_types
                                      if t.unwrap().keyword_typename in STRINGS) == 1:
            return Result("const NtsStringView*", "StringView" + or_null, "string", nullable)
        if keyword in SCALARS and not nullable:
            c, ts = SCALARS[keyword]
            return Result(c, ts, "scalar")
        raise Skip(f"result type {idl_type.syntactic_form}")

    @staticmethod
    def default_value(argument):
        """The C++ value of an argument's IDL default, which page script's
        binding passes when the argument is missing."""
        default = argument.default_value
        literal = default.literal if default is not None else None
        if literal in ("true", "false"):
            return literal
        if literal == "null":
            unwrapped = argument.idl_type.unwrap(nullable=True)
            return "blink::String()" if unwrapped.keyword_typename in STRINGS else "nullptr"
        if literal is not None and re.fullmatch(r"-?[0-9.]+(e-?[0-9]+)?", literal):
            return literal
        if (literal is not None and re.fullmatch(r'"[ -!#-~]*"', literal)
                and argument.idl_type.unwrap().keyword_typename in STRINGS):
            return f"blink::AtomicString({literal})"
        raise Skip(f"default `{literal}` of argument {argument.identifier}")

    # -- members ---------------------------------------------------------

    def call(self, context, arguments, num_of_args=None):
        """Blink's call expression for a member, placeholders filled."""
        expression = bind_interface._make_blink_api_call(SymbolScopeNode(), context, num_of_args)
        values = {
            "blink_receiver": "receiver",
            "exception_state": "exception_state",
            "isolate": "context.v8_isolate.get()",
            "execution_context": "context.document->GetExecutionContext()",
        }
        values.update(arguments)

        def fill(match):
            key = match.group(1)
            if key not in values:
                raise Skip(f"needs ${{{key}}}")
            return values[key]

        return re.sub(r"\$\{(\w+)\}", fill, expression)

    def include(self, member):
        """The headers declaring what a member's call names. Blink records
        them per interface, merged across its partials and mixins; the
        modules-side ones are for members skipped below."""
        for owner in (getattr(member, "owner", None), getattr(member, "owner_mixin", None)):
            info = getattr(owner, "code_generator_info", None)
            if info is not None and info.blink_headers:
                self.headers.update(path for path in info.blink_headers
                                    if not path.startswith("third_party/blink/renderer/modules/"))

    def check_member(self, member):
        ext = member.extended_attributes
        if getattr(member, "is_static", False):
            raise Skip("static")
        if "RuntimeEnabled" in ext:
            raise Skip("[RuntimeEnabled]")
        if web_idl.Component("modules") in member.components:
            raise Skip("defined in Blink's modules component; the adapter links core")
        if "ScriptState" in ext.values_of("CallWith") or "ThisValue" in ext.values_of("CallWith"):
            raise Skip("[CallWith=ScriptState] needs a script context")

    def bind(self, interface, member, symbol, params, result, context, num_of_args=None, filled=(), tail=None):
        placeholders = {}
        for index, param in enumerate(params):
            if param.idl_name is not None:
                placeholders[name_style.arg_f("arg{}_{}", index + 1, param.idl_name)] = param.expr
        if tail is not None:
            identifier, index, vector = tail
            placeholders[name_style.arg_f("arg{}_{}", index + 1, identifier)] = vector
        for index, (idl_name, value) in enumerate(filled, start=len(params)):
            placeholders[name_style.arg_f("arg{}_{}", index + 1, idl_name)] = value
        expression = self.call(context, placeholders, num_of_args)
        throws = "exception_state" in expression
        # Setters and operations only, as bind_gen's make_steps_of_ce_reactions.
        reactions = "CEReactions" in member.extended_attributes and not context.attribute_get
        self.include(member)
        for param in params:
            if param.include:
                self.headers.add(param.include)
        function = Function(interface, symbol, params, result, expression, throws, reactions)
        self.functions.append(function)
        return function

    def method_line(self, interface, name, function):
        notes = [f"@ntsSymbol {function.symbol}"] + (list(THROWS) if function.throws else [])
        params = [f"this: {interface.identifier}"] + [p.ts for p in function.params]
        if function.throws:
            params.append(ERROR_TS)
        doc = "    /**\n" + "".join(f"     * {note}\n" for note in notes) + "     */\n"
        return f"{doc}    {name}({', '.join(params)}): {function.result.ts};"

    def attribute(self, interface, attribute):
        base = CodeGenContext(interface=interface, class_name="V8" + interface.identifier)
        identifier = attribute.identifier
        getter = setter = None
        try:
            self.check_member(attribute)
            result = self.result(attribute.idl_type)
            context = base.make_copy(attribute=attribute, attribute_get=True)
            getter = self.bind(interface, attribute, f"nts_dom_{interface.identifier}_get_{identifier}", [],
                               result, context)
        except Skip as why:
            self.skip(interface, "get " + identifier, str(why))
        if not attribute.is_readonly:
            try:
                self.check_member(attribute)
                param = self.parameter(attribute.idl_type, "value")
                param.idl_name = "value"
                context = base.make_copy(attribute=attribute, attribute_set=True)
                setter = self.bind(interface, attribute, f"nts_dom_{interface.identifier}_set_{identifier}",
                                   [param], Result("void", "void", "void"), context)
                setter.expression = self.call(context, {"arg1_value": param.expr})
            except Skip as why:
                self.skip(interface, "set " + identifier, str(why))
        if getter is None and setter is None:
            return
        lines = self.members.setdefault(interface.identifier, [])
        tags = []
        if getter is not None:
            lines.append(self.method_line(interface, f"_get_{identifier}", getter))
            tags.append(f"@ntsGet _get_{identifier}")
        if setter is not None:
            lines.append(self.method_line(interface, f"_set_{identifier}", setter))
            tags.append(f"@ntsSet _set_{identifier}")
        doc = "    /**\n" + "".join(f"     * {tag}\n" for tag in tags) + "     */\n"
        written = setter.params[0].ts.split(": ", 1)[1] if setter is not None else None
        if getter is not None and setter is not None and written != getter.result.ts:
            lines.append(f"{doc}    get {identifier}(): {getter.result.ts};\n{doc}    set {identifier}(value: {written});")
        elif getter is not None:
            readonly = "" if setter is not None else "readonly "
            lines.append(f"{doc}    {readonly}{identifier}: {getter.result.ts};")
        else:
            lines.append(f"{doc}    set {identifier}(value: {written});")

    def operation(self, interface, group):
        """Each overload, at each arity a caller can write: every optional
        argument from the first one left out takes its default, or truncates
        the call where it has none. TypeScript overloads, longest first."""
        name = group.identifier
        if not name:
            return
        variants = []
        for operation in group:
            try:
                self.check_member(operation)
                result = self.result(operation.return_type)
                variadic = self.variadic(operation)
            except Skip as why:
                self.skip(interface, f"{name}/{len(operation.arguments)}", str(why))
                continue
            if variadic is not None:
                variants.extend(variadic(result))
                continue
            arguments = operation.arguments
            required = sum(1 for argument in arguments if not argument.is_optional)
            for count in range(len(arguments), required - 1, -1):
                try:
                    params = []
                    for argument in arguments[:count]:
                        param = self.parameter(argument.idl_type, argument.identifier)
                        param.idl_name = argument.identifier
                        params.append(param)
                    truncate = next((index for index in range(count, len(arguments))
                                     if arguments[index].default_value is None), None)
                    filled = [(argument.identifier, self.default_value(argument))
                              for argument in arguments[count:truncate]]
                    variants.append((operation, params, result, truncate, filled, None))
                except Skip as why:
                    self.skip(interface, f"{name}/{count}", str(why))
        base = CodeGenContext(interface=interface, class_name="V8" + interface.identifier)
        lines = self.members.setdefault(interface.identifier, [])
        used = set()
        for operation, params, result, truncate, filled, tail in variants:
            symbol = f"nts_dom_{interface.identifier}_{name}"
            if len(variants) > 1:
                symbol += f"_{len(params)}"
                while symbol in used:
                    symbol += "x"
            used.add(symbol)
            try:
                context = base.make_copy(operation_group=group, operation=operation)
                function = self.bind(interface, operation, symbol, params, result, context, truncate, filled, tail)
            except Skip as why:
                self.skip(interface, f"{name}/{len(params)}", str(why))
                continue
            lines.append(self.method_line(interface, name, function))

    VARIADIC_ARITIES = (1, 2, 3)

    def variadic(self, operation):
        """A variadic string tail (`classList.add(...tokens)`), bound at one,
        two and three arguments: Blink takes the tail as one Vector<String>,
        which the adapter builds from the given strings. None when the last
        argument is not variadic; Skip when its element type is not text."""
        arguments = operation.arguments
        if not arguments or not arguments[-1].is_variadic:
            return None
        tail = arguments[-1]
        element = tail.idl_type.unwrap()
        if element.keyword_typename not in STRINGS:
            raise Skip(f"variadic {tail.idl_type.syntactic_form}")
        fixed = []
        for argument in arguments[:-1]:
            if argument.is_optional:
                raise Skip("variadic after an optional argument")
            param = self.parameter(argument.idl_type, argument.identifier)
            param.idl_name = argument.identifier
            fixed.append(param)

        def variants(result):
            out = []
            for count in reversed(self.VARIADIC_ARITIES):
                params = list(fixed)
                values = []
                for index in range(count):
                    param = self.parameter(element, f"{tail.identifier}{index + 1}")
                    param.idl_name = None
                    params.append(param)
                    values.append(f"blink::String({param.expr})")
                vector = f"blink::Vector<blink::String>({{{', '.join(values)}}})"
                out.append((operation, params, result, None, [], (tail.identifier, len(fixed), vector)))
            return out
        return variants

    def downcast(self, interface):
        """`asElement(node)`: the object as an Element, or null -- Blink's
        `DynamicTo`, the checked narrowing a program needs where the IDL
        answers a wider type (`firstChild` is a Node, `event.target` an
        EventTarget). It starts from the class Blink's casts know: a Node
        for what derives from one, `ToNode()` for a Node from an
        EventTarget, the hierarchy's root for the rest."""
        identifier = interface.identifier
        root = self.hierarchy_root(interface)
        if root is interface:
            return
        cls = blink_class_name(interface)
        if identifier == "Node":
            source = root.identifier
            expr = f"ObjectOf<blink::{blink_class_name(root)}>(eventTarget)->ToNode()"
        else:
            source = "Node" if "Node" in self.ancestors(interface) and "Node" in self.bound else root.identifier
            expr = f"blink::DynamicTo<blink::{cls}>(ObjectOf<blink::{source}>({source[0].lower() + source[1:]}))"
        tag = self.handle_tag(identifier)
        name = source[0].lower() + source[1:]
        params = [Param(name, f"{self.handle_tag(source)}* {name}", f"{name}: {source}", "", False)]
        function = Function(interface, f"nts_dom_as_{identifier}", params,
                            Result(f"{tag}*", f"{identifier} | null", "node"), expr, False, False)
        function.downcast = True
        function.source = source
        self.functions.append(function)

    def skip(self, interface, name, why):
        self.skipped.append({"interface": interface.identifier, "member": name, "why": why})

    def run(self):
        for interface in self.interfaces:
            self.headers.add(PathManager(interface).blink_path(ext="h"))
            self.downcast(interface)
            for attribute in interface.attributes:
                self.attribute(interface, attribute)
            for group in interface.operation_groups:
                self.operation(interface, group)

    # -- files -----------------------------------------------------------

    def parent(self, interface):
        inherited = interface.inherited
        while inherited is not None and inherited.identifier not in self.bound:
            inherited = inherited.inherited
        return inherited

    def adapter_function(self, function):
        downcast = getattr(function, "downcast", False)
        c_params = ([] if downcast else [f"{self.handle_tag(function.interface.identifier)}* self"]) + \
            [p.c for p in function.params] + ([ERROR_C] if function.throws else [])
        lines = [f"{function.result.c} {function.symbol}({', '.join(c_params)}) {{"]
        if function.needs_context():
            lines.append("  NtsDomContext& context = nts_dom::Current();")
        else:
            lines.append("  nts_dom::AssertEntered();")
        if function.throws:
            lines.append("  Throws exception_state(error);")
        if function.reactions:
            lines.append("  blink::CEReactionsScope reactions(context.v8_isolate);")
        if not downcast:
            lines.append(f"  auto* receiver = {self.node(function.interface, 'self')};")
        expression = function.expression
        kind = function.result.kind
        if kind == "void":
            lines.append(f"  {expression};")
        elif kind == "node":
            lines.append(f"  return HandleOf<{function.result.c[:-1]}>({expression});")
        elif kind == "string":
            nullable = "true" if function.result.nullable else "false"
            lines.append(f"  return context.Lend(nts_dom::AsString({expression}), {nullable});")
        else:
            # An enum-typed answer (`eventPhase()` is a PhaseType) is its
            # IDL number.
            lines.append(f"  return static_cast<{function.result.c}>({expression});")
        lines.append("}")
        return "\n".join(lines)

    def files(self):
        revision = self.allowlist.get("chromiumRevision", "")
        banner = (f"Generated by tooling/chromium/bindgen/generate.py from Blink's IDL at Chromium {revision}.\n"
                  "Do not edit; regenerate.")
        typedefs = "\n".join(f"typedef struct {self.handle_tag(i.identifier)} {self.handle_tag(i.identifier)};"
                             for i in self.interfaces)
        prototypes = []
        for function in self.functions:
            downcast = getattr(function, "downcast", False)
            c_params = ([] if downcast else [f"{self.handle_tag(function.interface.identifier)}* self"]) + \
                [p.c for p in function.params] + ([ERROR_C] if function.throws else [])
            prototypes.append(f"{function.result.c} {function.symbol}({', '.join(c_params)});")
        header = f"""/* {banner} */
#ifndef NTS_CHROMIUM_DOM_IDL_H_
#define NTS_CHROMIUM_DOM_IDL_H_
#include <stdbool.h>
#include <stdint.h>

#include "nts_string_view.h"

#ifdef __cplusplus
extern "C" {{
#endif

/* A DOM exception a member reported: what the program throws, by
 * nts_dom_exception_take_message (dom_abi.h). */
typedef struct NtsDomException NtsDomException;
{typedefs}

{chr(10).join(prototypes)}

#ifdef __cplusplus
}}
#endif
#endif
"""
        includes = "\n".join(f'#include "{path}"' for path in sorted(self.headers))
        adapter = f"""// {banner.replace(chr(10), chr(10) + '// ')}
#include "nts/dom_idl.h"

#include "nts/dom_context.h"
{includes}

namespace {{
// The ExceptionState of a member that may throw: Blink records the code and
// message without V8 (DummyExceptionStateForTesting is an ExceptionState with
// no isolate), and what it recorded is reported through the program's error
// slot (@ntsThrows), which the compiler reads after the call and throws. A
// NULL slot ignores it, as C's GError convention does.
class Throws {{
  STACK_ALLOCATED();

 public:
  explicit Throws(NtsDomException** error) : error_(error) {{}}
  ~Throws() {{
    if (state_.HadException() && error_ && !*error_)
      *error_ = nts_dom::Report(state_.Code(), state_.Message());
  }}
  operator blink::ExceptionState&() {{ return state_; }}

 private:
  blink::DummyExceptionStateForTesting state_;
  raw_ptr<NtsDomException*> error_;
}};
}}  // namespace

// In Blink's namespace, as the bindings are: bind_gen's expressions name
// Blink's own (`html_names::kClassAttr`). The symbols are C's either way.
namespace blink {{
extern "C" {{
{(chr(10) * 2).join(self.adapter_function(function) for function in self.functions)}
}}  // extern "C"
}}  // namespace blink
"""
        types = []
        for interface in self.interfaces:
            identifier = interface.identifier
            parent = self.parent(interface)
            types.append(f"  export interface {identifier}OwnMethods {{")
            types.extend(self.members.get(identifier, []))
            types.append("  }")
            if parent is None:
                # A hierarchy's root: every root shares the one counted pair,
                # which roots any ScriptWrappable.
                types.append(f"  export type {identifier}Methods = {identifier}OwnMethods;")
                types.append(f'  export type {identifier} = HostClass<"{self.handle_tag(identifier)}", null, '
                             f'"nts_dom_retain", "nts_dom_release"> & {identifier}Methods;')
            else:
                types.append(f"  export type {identifier}Methods = {identifier}OwnMethods & {parent.identifier}Methods;")
                types.append(f'  export type {identifier} = HostClass<"{self.handle_tag(identifier)}", '
                             f"{parent.identifier}> & {identifier}Methods;")
            downcast = next((f for f in self.functions if getattr(f, "downcast", False) and f.interface is interface), None)
            if downcast is not None:
                types.append(f"  /** @ntsSymbol nts_dom_as_{identifier} */")
                types.append(f"  export function as{identifier}({downcast.params[0].ts}): {identifier} | null;")
        declarations = f"""// {banner.replace(chr(10), chr(10) + '// ')}
/** @ntsHeader "dom_idl.h" */
declare module "nts:dom" {{
  import type {{ CNumber, HostClass, Opaque, Ptr, StringView }} from "c:types";
  /** A DOM exception a member reported, thrown as an `Error` "Name: message". */
  export type DOMException = Opaque<"NtsDomException">;
{chr(10).join(types)}
}}
"""
        report = {"bound": len(self.functions), "skipped": self.skipped}
        return {
            os.path.join(LANE, "native", "ffi", "dom_idl.h"): header,
            os.path.join(LANE, "native", "dom_idl.cc"): adapter,
            os.path.join(LANE, "types", "dom-idl.d.ts"): declarations,
            os.path.join(os.path.dirname(__file__), "report.json"): json.dumps(report, indent=2) + "\n",
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if a generated file differs")
    parser.add_argument("--database", default=DATABASE)
    options = parser.parse_args()
    bind_gen.init(
        web_idl_database_path=options.database,
        root_src_dir=SRC,
        root_gen_dir=os.path.join(SRC, "out", "NtsPerf", "gen"),
        component_reldirs={
            web_idl.Component("core"): "third_party/blink/renderer/bindings/core/v8",
            web_idl.Component("modules"): "third_party/blink/renderer/bindings/modules/v8",
        })
    from bind_gen.package_initializer import package_initializer
    with open(ALLOWLIST) as file:
        allowlist = json.load(file)
    generator = Generator(package_initializer().web_idl_database(), allowlist)
    generator.run()
    stale = []
    for path, text in generator.files().items():
        if options.check:
            current = open(path).read() if os.path.exists(path) else None
            if current != text:
                stale.append(os.path.relpath(path, ROOT))
        else:
            with open(path, "w") as file:
                file.write(text)
    if stale:
        sys.exit("stale generated files: " + ", ".join(stale))
    print(f"bound {len(generator.functions)} functions, skipped {len(generator.skipped)}")


if __name__ == "__main__":
    main()
