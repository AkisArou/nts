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

  dom/abi/dom_idl.h        the C ABI: one function per member and arity
  adapter/dom_idl.cc       the adapter: each function, Blink's call
  dom/types/dom-idl.d.ts   module "nts:dom", as a program writes it

(under runtime/chromium)

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
import itertools
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SRC = os.path.join(ROOT, "third_party", "chromium", "src")
SCRIPTS = os.path.join(SRC, "third_party", "blink", "renderer", "bindings", "scripts")
LANE = os.path.join(ROOT, "runtime", "chromium")
DATABASE = os.path.join(SRC, "out", "NtsPerf", "gen", "third_party", "blink", "renderer", "bindings",
                        "web_idl_database.pickle")
ALLOWLIST = os.path.join(os.path.dirname(__file__), "allowlist.json")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, os.path.join(SRC, "third_party", "pyjson5", "src"))

import web_idl  # noqa: E402
import bind_gen  # noqa: E402
from bind_gen import interface as bind_interface  # noqa: E402
from bind_gen import name_style  # noqa: E402
from bind_gen.blink_v8_bridge import blink_class_name, blink_type_info, native_value_tag, v8_bridge_class_name  # noqa: E402
from bind_gen.code_node import SymbolScopeNode  # noqa: E402
from bind_gen.codegen_context import CodeGenContext  # noqa: E402
from bind_gen.path_manager import PathManager  # noqa: E402


class Skip(Exception):
    """A member this generator does not bind yet, and why."""


# The IDL's numeric types. Every number crosses as the program's own double
# (`CNumber<"double">`, written as a plain number), and the adapter converts
# it as page script's binding converts it: Blink's own NativeValueTraits on the
# same value, so ToInt32's wrap, [EnforceRange]'s TypeError, [Clamp]'s rounding
# and a restricted double's refusal of NaN are Blink's, message and all. A
# number back is its exact double.
NUMERIC = {"byte", "octet", "short", "unsigned short", "long", "unsigned long", "long long",
           "unsigned long long", "float", "unrestricted float", "double", "unrestricted double"}
# What a conversion can refuse, so the member takes an error slot for it.
THROWING_CONVERSIONS = ("IDLDouble", "IDLFloat", "EnforceRange")
# What crosses as itself: the IDL type, the C type, the TypeScript type.
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
    "double": ("double", 'CNumber<"double">'),
    "unrestricted double": ("double", 'CNumber<"double">'),
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
    def __init__(self, name, c, ts, expr, context, include=None, prelude=None, may_throw=False):
        self.name, self.c, self.ts, self.expr = name, c, ts, expr
        self.context = context  # whether converting it needs the context
        self.include = include
        # A statement converting it before the call, `{exceptions}` naming the
        # ExceptionState it reports to; and whether that can fail.
        self.prelude, self.may_throw = prelude, may_throw


class Result:
    def __init__(self, c, ts, kind, nullable=False):
        self.c, self.ts, self.kind, self.nullable = c, ts, kind, nullable


class Function:
    """One C function: a getter, a setter, or one arity of an operation."""

    def __init__(self, interface, symbol, params, result, expression, throws, reactions):
        self.interface, self.symbol, self.params, self.result = interface, symbol, params, result
        self.expression, self.throws, self.reactions = expression, throws, reactions
        self.statements = []  # run before the expression, after the receiver
        self.receiver = True  # false for a constructor or a downcast: no `self`

    def needs_context(self):
        return (self.reactions or self.result.kind == "string" or any(p.context for p in self.params)
                or "context." in self.expression or any("context." in s for s in self.statements))


class Generator:
    def __init__(self, database, allowlist):
        self.database = database
        self.allowlist = allowlist
        self.interfaces = [database.find(name) for name in allowlist["interfaces"]]
        self.bound = {interface.identifier for interface in self.interfaces}
        self.skipped = []
        self.functions = []
        self.members = {}  # interface identifier -> TypeScript member lines
        # What bind_gen's expressions name beyond each interface's own header:
        # its helpers (ToDocumentFromExecutionContext), and LocalDOMWindow,
        # Window's receiver.
        self.headers = {"third_party/blink/renderer/bindings/core/v8/generated_code_helper.h",
                        "third_party/blink/renderer/core/frame/local_dom_window.h"}
        self.statics = []  # adapter-level definitions the functions use
        # Every interface Blink's core component defines, in a fixed order:
        # what `instanceof` can be asked of (nts_dom_is), bound or not.
        self.checkable = sorted((i for i in database.interfaces
                                 if web_idl.Component("core") in i.components and not i.is_mixin),
                                key=lambda i: i.identifier)
        self.interface_id = {i.identifier: index for index, i in enumerate(self.checkable)}

    # -- types -----------------------------------------------------------

    @staticmethod
    def handle_tag(identifier):
        return "NtsDom" + identifier

    def bound_interface(self, idl_type):
        definition = idl_type.unwrap(nullable=True, typedef=True).type_definition_object
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
        unwrapped = idl_type.unwrap(nullable=True, typedef=True)
        or_null = " | null" if nullable else ""
        if unwrapped.is_interface:
            interface = self.bound_interface(idl_type)
            expr = self.node(interface, name)
            return Param(name, f"{self.handle_tag(interface.identifier)}* {name}",
                         f"{name}: {interface.identifier}{or_null}", expr, False)
        if unwrapped.is_union:
            members = unwrapped.flattened_member_types
            strings = [t for t in members if t.unwrap().keyword_typename in STRINGS]
            # The string is taken only where it is the one primitive member and
            # the others are interfaces (TrustedScript, TrustedHTML): a union
            # with several primitive arms (`hidden`'s boolean, double and
            # string) needs one function per arm, chosen by the value's type,
            # which an accessor write cannot do yet.
            primitives = [t for t in members if not t.unwrap().is_interface]
            if len(strings) != 1 or len(primitives) != 1:
                raise Skip(f"parameter type {idl_type.syntactic_form}")
            union = blink_type_info(unwrapped).typename
            expr = f"blink::MakeGarbageCollected<blink::{union}>({self.text(strings[0], name)}.Text())"
            if nullable:
                expr = f"({name} ? {expr} : nullptr)"
            return Param(name, f"const NtsBorrowedString* {name}", f"{name}: StringView{or_null}", expr, True,
                         PathManager(unwrapped.union_definition_object).api_path(ext="h"))
        keyword = unwrapped.keyword_typename
        if keyword in STRINGS:
            return Param(name, f"const NtsBorrowedString* {name}", f"{name}: StringView{or_null}",
                         self.text(unwrapped, name), True)
        if keyword in NUMERIC and not nullable:
            ts = f'{name}: CNumber<"double">'
            if keyword == "unrestricted double":
                return Param(name, f"double {name}", ts, name, False)
            tag = native_value_tag(idl_type)
            prelude = (f"const auto {name}_converted = blink::NativeValueTraits<blink::{tag}>::NativeValue("
                       f"context.v8_isolate.get(), v8::Number::New(context.v8_isolate.get(), {name}), {{exceptions}});")
            return Param(name, f"double {name}", ts, f"{name}_converted", True, prelude=prelude,
                         may_throw=any(mark in tag for mark in THROWING_CONVERSIONS))
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
        unwrapped = idl_type.unwrap(nullable=True, typedef=True)
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
        # Only where the string is the one primitive arm, as for a parameter:
        # a union of several primitives answers a V8 value (`hidden`'s Ret).
        if unwrapped.is_union and sum(1 for t in unwrapped.flattened_member_types
                                      if t.unwrap().keyword_typename in STRINGS) == 1 \
                and sum(1 for t in unwrapped.flattened_member_types if not t.unwrap().is_interface) == 1:
            return Result("const NtsStringView*", "StringView" + or_null, "string", nullable)
        if keyword in NUMERIC and not nullable:
            return Result("double", 'CNumber<"double">', "scalar")
        if keyword in SCALARS and not nullable:
            c, ts = SCALARS[keyword]
            return Result(c, ts, "scalar")
        raise Skip(f"result type {idl_type.syntactic_form}")

    def default_value(self, argument):
        """The C++ value of an argument's IDL default, which page script's
        binding passes when the argument is missing."""
        default = argument.default_value
        literal = default.literal if default is not None else None
        unwrapped = argument.idl_type.unwrap()
        # `optional EventInit init = {}`: an empty dictionary, as V8's
        # binding makes one from `undefined`.
        if literal == "{}" and unwrapped.is_dictionary:
            dictionary = unwrapped.type_definition_object
            self.headers.add(PathManager(dictionary).api_path(ext="h"))
            return f"blink::{dictionary.identifier}::Create(context.v8_isolate.get())"
        # `(sequence<...> or USVString) init = ""`: the union holding that
        # string, the arm V8's conversion of the default picks.
        if (unwrapped.is_union and literal is not None and re.fullmatch(r'"[ -!#-~]*"', literal)
                and any(t.unwrap().keyword_typename in STRINGS for t in unwrapped.flattened_member_types)):
            self.headers.add(PathManager(unwrapped.union_definition_object).api_path(ext="h"))
            union = blink_type_info(unwrapped).typename
            return f"blink::MakeGarbageCollected<blink::{union}>(blink::String({literal}))"
        if literal in ("true", "false"):
            return literal
        if literal == "null":
            unwrapped = argument.idl_type.unwrap(nullable=True, typedef=True)
            if unwrapped.is_any:
                return "blink::ScriptValue::CreateNull(context.v8_isolate.get())"
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
            "script_state": "script_state",
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
        if "ThisValue" in ext.values_of("CallWith"):
            raise Skip("[CallWith=ThisValue] needs page script's receiver")

    def bind(self, interface, member, symbol, params, result, context, num_of_args=None, filled=(), tail=None):
        placeholders = {}
        for index, param in enumerate(params):
            if param.idl_name is not None:
                placeholders[name_style.arg_f("arg{}_{}", index + 1, param.idl_name)] = param.expr
        if tail is not None:
            identifier, index, vector, _ = tail
            placeholders[name_style.arg_f("arg{}_{}", index + 1, identifier)] = vector
        for index, (idl_name, value) in enumerate(filled, start=len(params)):
            placeholders[name_style.arg_f("arg{}_{}", index + 1, idl_name)] = value
        expression = self.call(context, placeholders, num_of_args)
        throws = "exception_state" in expression or any(param.may_throw for param in params)
        # Setters and operations only, as bind_gen's make_steps_of_ce_reactions.
        reactions = "CEReactions" in member.extended_attributes and not context.attribute_get
        self.include(member)
        for param in params:
            if param.include:
                self.headers.add(param.include)
        function = Function(interface, symbol, params, result, expression, throws, reactions)
        # Window is implemented by DOMWindow, and every member but a
        # [CrossOrigin] one by LocalDOMWindow: bind_gen casts the receiver so,
        # and the program's window is always its own document's, a local one.
        function.local_window = (interface.identifier == "Window"
                                 and "CrossOrigin" not in member.extended_attributes)
        if re.search(r"\bscript_state\b", expression):
            # [CallWith=ScriptState]: the main world's, entered for the call.
            function.statements = ["blink::ScriptState* script_state = context.MainWorld()",
                                   "blink::ScriptState::Scope script_scope(script_state)"]
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
        if attribute.idl_type.syntactic_form == "EventHandler":
            self.event_handler(interface, attribute, base)
            return
        arms = self.primitive_arms(attribute.idl_type) if not attribute.is_readonly else None
        if arms:
            self.arm_setters(interface, attribute, base, arms)
        elif not attribute.is_readonly:
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

    ARM_NAMES = {"boolean": "boolean", "DOMString": "string", "unrestricted double": "number", "double": "number"}

    def primitive_arms(self, idl_type):
        """The arms of a union with several primitive members (`hidden`'s
        boolean, unrestricted double and DOMString), or None."""
        unwrapped = idl_type.unwrap(nullable=True, typedef=True)
        if not unwrapped.is_union:
            return None
        primitives = [t.unwrap() for t in unwrapped.flattened_member_types if not t.unwrap().is_interface]
        if len(primitives) < 2 or any(t.keyword_typename not in self.ARM_NAMES for t in primitives):
            return None
        return unwrapped, primitives

    def arm_setters(self, interface, attribute, base, arms):
        """A setter whose value is a union of several primitives, bound once
        per arm (`_set_hidden_boolean`, `_set_hidden_string`): the arm a write
        means is the value's type, which a caller knows statically, and Blink
        receives the union V8's binding builds for that value. Methods, not a
        property: one property can name only one setter."""
        union_type, primitives = arms
        union = blink_type_info(union_type).typename
        self.headers.add(PathManager(union_type.union_definition_object).api_path(ext="h"))
        lines = self.members.setdefault(interface.identifier, [])
        identifier = attribute.identifier
        for arm in primitives:
            name = self.ARM_NAMES[arm.keyword_typename]
            try:
                self.check_member(attribute)
                param = self.parameter(arm, "value")
                param.idl_name = "value"
                value = f"{param.expr}.Text()" if param.context else param.expr
                param.expr = f"blink::MakeGarbageCollected<blink::{union}>({value})"
                context = base.make_copy(attribute=attribute, attribute_set=True)
                setter = self.bind(interface, attribute, f"nts_dom_{interface.identifier}_set_{identifier}_{name}",
                                   [param], Result("void", "void", "void"), context)
            except Skip as why:
                self.skip(interface, f"set {identifier} ({name})", str(why))
                continue
            lines.append(self.method_line(interface, f"_set_{identifier}_{name}", setter))

    HANDLER_ARMS = {
        # arm: (the closure's result in TypeScript and in C, the context's arguments)
        "void": ("void", "void", "handler, nullptr"),
        "boolean": ("boolean", "bool", "nullptr, handler"),
    }

    def event_handler(self, interface, attribute, base):
        """`onclick`, an EventHandler attribute, written with a compiled
        closure: one setter per closure result -- `_set_onclick_void`, and
        `_set_onclick_boolean`, whose false cancels the event as HTML's event
        handler processing says -- and `_set_onclick_null`. Each goes through
        Blink's own attribute accessors, so a handler lands where the
        attribute puts it (body's `onblur` on the window), replaces the
        program's previous one in place, and gives that one's closure back.
        The getter would answer the program's closure, which no binding
        returns yet."""
        identifier = attribute.identifier
        self.skip(interface, "get " + identifier, "an event handler's value is the program's closure")
        try:
            self.check_member(attribute)
        except Skip as why:
            self.skip(interface, "set " + identifier, str(why))
            return
        self.include(attribute)
        get_context = base.make_copy(attribute=attribute, attribute_get=True)
        set_context = base.make_copy(attribute=attribute, attribute_set=True)
        previous = self.call(get_context, {})
        lines = self.members.setdefault(interface.identifier, [])
        arms = dict(self.HANDLER_ARMS)
        arms["null"] = None
        for arm, shape in arms.items():
            if shape is None:
                params, value = [], "nullptr"
            else:
                ts_result, c_result, chosen = shape
                params = [Param("handler",
                                f"{c_result} (*handler)(NtsDomEvent*, void*), void* handler_closure, "
                                f"void (*handler_destroy)(void*)",
                                f"handler: Closure<(event: Event) => {ts_result}>", "", True)]
                value = f"context.Handler({chosen}, handler_closure, handler_destroy)"
            setter = Function(interface, f"nts_dom_{interface.identifier}_set_{identifier}_{arm}", params,
                              Result("void", "void", "void"), "context.Replaced(previous)", False, False)
            setter.local_window = (interface.identifier == "Window"
                                   and "CrossOrigin" not in attribute.extended_attributes)
            setter.statements = [
                "nts_dom::HandlerWrite write",
                f"blink::EventListener* previous = {previous}",
                self.call(set_context, {"arg1_value": value}),
            ]
            self.functions.append(setter)
            lines.append(self.method_line(interface, f"_set_{identifier}_{arm}", setter))

    def variants(self, interface, label, overloads, result_of):
        """Each overload, at each arity a caller can write: every optional
        argument from the first one left out takes its default, or truncates
        the call where it has none. Longest first, as TypeScript overloads
        are read. (operation, params, result, truncate, filled, tail)."""
        variants = []
        for overload in overloads:
            try:
                self.check_member(overload)
                result = result_of(overload)
                variadic = self.variadic(overload)
            except Skip as why:
                self.skip(interface, f"{label}/{len(overload.arguments)}", str(why))
                continue
            if variadic is not None:
                variants.extend(variadic(result))
                continue
            arguments = overload.arguments
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
                    variants.append((overload, params, result, truncate, filled, None))
                except Skip as why:
                    self.skip(interface, f"{label}/{count}", str(why))
        return variants

    @staticmethod
    def symbol_for(base, variants, tail, params, used):
        """One C symbol per variant: an overload set's are told apart by
        arity, or by a variadic tail's arms."""
        symbol = base
        if tail is not None and tail[3] is not None:
            symbol += f"_{tail[3]}"
        elif len(variants) > 1:
            symbol += f"_{len(params)}"
            while symbol in used:
                symbol += "x"
        used.add(symbol)
        return symbol

    def operation(self, interface, group):
        name = group.identifier
        if not name:
            return
        variants = self.variants(interface, name, group, lambda operation: self.result(operation.return_type))
        base = CodeGenContext(interface=interface, class_name="V8" + interface.identifier)
        lines = self.members.setdefault(interface.identifier, [])
        used = set()
        for operation, params, result, truncate, filled, tail in variants:
            symbol = self.symbol_for(f"nts_dom_{interface.identifier}_{name}", variants, tail, params, used)
            try:
                context = base.make_copy(operation_group=group, operation=operation)
                function = self.bind(interface, operation, symbol, params, result, context, truncate, filled, tail)
            except Skip as why:
                self.skip(interface, f"{name}/{len(params)}", str(why))
                continue
            lines.append(self.method_line(interface, name, function))

    def constructors(self, interface):
        """`new URL(url, base)` as `newURL(url, base)`: each constructor
        overload at each arity, calling what V8's binding calls --
        `URL::Create(...)` -- through Blink's own generator, with the
        constructed object as the result."""
        if not interface.constructor_groups:
            return
        group = interface.constructor_groups[0]
        identifier = interface.identifier
        # `[HTMLConstructor] constructor()` is a custom element's: it throws
        # anywhere but inside one's definition.
        if any("HTMLConstructor" in constructor.extended_attributes for constructor in group):
            self.skip(interface, "constructor", "[HTMLConstructor]: a custom element's constructor")
            return
        made = Result(f"{self.handle_tag(identifier)}*", identifier, "node")
        variants = self.variants(interface, "constructor", group, lambda constructor: made)
        base = CodeGenContext(interface=interface, class_name="V8" + identifier)
        used = set()
        for constructor, params, result, truncate, filled, tail in variants:
            symbol = self.symbol_for(f"nts_dom_new_{identifier}", variants, tail, params, used)
            try:
                context = base.make_copy(constructor_group=group, constructor=constructor)
                function = self.bind(interface, constructor, symbol, params, result, context, truncate, filled, tail)
            except Skip as why:
                self.skip(interface, f"constructor/{len(params)}", str(why))
                continue
            function.receiver = False
            function.constructs = interface

    VARIADIC_ARITIES = (0, 1, 2, 3)

    def variadic(self, operation):
        """A variadic tail, bound at zero to three arguments. Blink takes the
        tail as one vector, which the adapter builds from the given values:
        strings (`classList.add(...tokens)`) as a Vector<String>, and the
        `(Node or DOMString or TrustedScript)` of `append(...nodes)` as the
        HeapVector of unions V8's binding builds -- every mix of the arms a
        program can give (a bound interface, the string) at each arity, each
        function named by its arms (`_ns`: a node, then a string). None when
        the last argument is not variadic; Skip when no element arm can be
        given."""
        arguments = operation.arguments
        if not arguments or not arguments[-1].is_variadic:
            return None
        tail = arguments[-1]
        element = tail.idl_type.unwrap()
        if element.keyword_typename in STRINGS:
            arms, union = [(None, element)], None
        elif element.is_union:
            union = blink_type_info(element).typename
            arms = []
            for member in element.flattened_member_types:
                unwrapped = member.unwrap()
                if unwrapped.keyword_typename in STRINGS:
                    arms.append(("s", unwrapped))
                elif unwrapped.is_interface and unwrapped.identifier in self.bound:
                    arms.append((unwrapped.identifier[0].lower(), unwrapped))
            if not arms or len({letter for letter, _ in arms}) != len(arms):
                raise Skip(f"variadic {tail.idl_type.syntactic_form}")
            self.headers.add(PathManager(element.union_definition_object).api_path(ext="h"))
        else:
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
                for chosen in itertools.product(arms, repeat=count):
                    params = list(fixed)
                    values = []
                    for index, (letter, arm) in enumerate(chosen):
                        param = self.parameter(arm, f"{tail.identifier}{index + 1}")
                        param.idl_name = None
                        params.append(param)
                        if union is None:
                            values.append(f"{param.expr}.Text()")
                        elif letter == "s":
                            values.append(f"blink::MakeGarbageCollected<blink::{union}>({param.expr}.Text())")
                        else:
                            values.append(f"blink::MakeGarbageCollected<blink::{union}>({param.expr})")
                    if union is None:
                        vector = f"blink::Vector<blink::String>({{{', '.join(values)}}})"
                        suffix = None
                    else:
                        vector = (f"blink::HeapVector<blink::Member<blink::{union}>>"
                                  f"({{{', '.join(values)}}})")
                        suffix = "".join(letter for letter, _ in chosen) or "0"
                    out.append((operation, params, result, None, [], (tail.identifier, len(fixed), vector, suffix)))
            return out
        return variants

    def downcast(self, interface):
        """`asElement(node)`: the object as an Element, or null -- through
        nts_dom_is, the check V8's binding makes for `instanceof`, so it
        holds for every interface. It starts from the hierarchy's root
        (from a Node for what derives from one, which every node has)."""
        identifier = interface.identifier
        root = self.hierarchy_root(interface)
        if root is interface:
            return
        source = "Node" if "Node" in self.ancestors(interface) and "Node" in self.bound else root.identifier
        name = {"Node": "node", "EventTarget": "target", "Event": "event"}.get(source, "object")
        tag = self.handle_tag(identifier)
        params = [Param(name, f"{self.handle_tag(source)}* {name}", f"{name}: {source}", "", False)]
        expr = f"nts_dom_is({name}, NTS_DOM_{identifier}) ? WrappableOf({name}) : nullptr"
        function = Function(interface, f"nts_dom_as_{identifier}", params,
                            Result(f"{tag}*", f"{identifier} | null", "node"), expr, False, False)
        function.downcast = True
        function.receiver = False
        function.source = source
        self.functions.append(function)

    def skip(self, interface, name, why):
        self.skipped.append({"interface": interface.identifier, "member": name, "why": why})

    def run(self):
        for interface in self.interfaces:
            self.headers.add(PathManager(interface).blink_path(ext="h"))
            self.downcast(interface)
            self.constructors(interface)
            for attribute in interface.attributes:
                self.attribute(interface, attribute)
            for group in interface.operation_groups:
                self.operation(interface, group)
            if interface.identifier == "CSSStyleDeclaration":
                self.css_properties(interface)
            else:
                self.named_properties(interface)

    def named_properties(self, interface):
        """`dataset.userId`: an interface's named getter, setter and deleter,
        which have no name of their own, as `_named_get`, `_named_set` and
        `_named_delete`. Each calls what V8's interceptor calls: the getter
        as it is implemented (DOMStringMap's `item`), whose null String is a
        name that is absent (undefined to page script, null here);
        AnonymousNamedSetter; AnonymousNamedDeleter. The deleter answers
        nothing: `delete dataset.absent` is true in page script too, where a
        deleter that does not intercept falls back to ordinary deletion."""
        properties = interface.indexed_and_named_properties
        if properties is None:
            return
        lines = self.members.setdefault(interface.identifier, [])
        cls = blink_class_name(interface)

        def named(role, operation, build):
            symbol = f"nts_dom_{interface.identifier}_named_{role}"
            try:
                self.check_member(operation)
                function = build()
            except Skip as why:
                self.skip(interface, f"named {role}", str(why))
                return
            self.include(operation)
            self.functions.append(function)
            lines.append(self.method_line(interface, f"_named_{role}", function))

        def name_param(operation):
            param = self.parameter(operation.arguments[0].idl_type, "name")
            if not param.context:
                raise Skip(f"name type {operation.arguments[0].idl_type.syntactic_form}")
            return param

        getter = properties.named_getter
        if getter is not None:
            def build_getter():
                param = name_param(getter)
                result = self.result(getter.return_type)
                if result.kind != "string" and result.kind != "node":
                    raise Skip(f"result type {getter.return_type.syntactic_form}")
                if result.kind == "string":
                    result = Result(result.c, result.ts.removesuffix(" | null") + " | null", "string", True)
                elif not result.ts.endswith(" | null"):
                    result = Result(result.c, result.ts + " | null", result.kind)
                method = (getter.extended_attributes.value_of("ImplementedAs") or getter.identifier
                          or "AnonymousNamedGetter")
                return Function(interface, f"nts_dom_{interface.identifier}_named_get", [param], result,
                                f"receiver->{method}({param.expr})", False, False)
            named("get", getter, build_getter)
        setter = properties.named_setter
        if setter is not None:
            def build_setter():
                param = name_param(setter)
                value = self.parameter(setter.arguments[1].idl_type, "value")
                throws = "RaisesException" in setter.extended_attributes
                arguments = [param.expr, value.expr] + (["exception_state"] if throws else [])
                return Function(interface, f"nts_dom_{interface.identifier}_named_set", [param, value],
                                Result("void", "void", "void"),
                                f"receiver->AnonymousNamedSetter({', '.join(arguments)})",
                                throws or value.may_throw, "CEReactions" in setter.extended_attributes)
            named("set", setter, build_setter)
        deleter = properties.named_deleter
        if deleter is not None:
            def build_deleter():
                param = name_param(deleter)
                return Function(interface, f"nts_dom_{interface.identifier}_named_delete", [param],
                                Result("void", "void", "void"),
                                f"receiver->AnonymousNamedDeleter(blink::AtomicString({param.expr}.Text()))",
                                False, "CEReactions" in deleter.extended_attributes)
            named("delete", deleter, build_deleter)

    @staticmethod
    def dashed(attribute):
        """CSSOM's camel-cased attribute to its property: a dash before each
        upper-case letter, lowered; a webkit-cased one (`webkitFoo`) starts
        with a dash too."""
        out = "".join("-" + c.lower() if c.isupper() else c for c in attribute)
        return "-" + out if attribute.startswith("webkit") else out

    def css_properties(self, interface):
        """`style.alignContent`: the CSS properties lib.dom.d.ts declares on
        CSSStyleDeclaration, which Blink serves through a named-property
        interceptor rather than IDL attributes. Read through Blink's own
        AnonymousNamedGetter -- what page script's read calls -- and written
        as CSSOM defines a camel-cased attribute's setter:
        setProperty(dashed name, value, "")."""
        import libdom
        lib = libdom.interfaces(open(libdom.LIB_DOM).read())
        if "CSSStyleDeclaration" not in lib:
            return
        # lib.dom.d.ts declares them on ancestors (CSSStyleDeclaration extends
        # CSSStyleProperties extends CSSStyleDeclarationBase); the receiver is
        # still a CSSStyleDeclaration.
        members, pending = set(lib["CSSStyleDeclaration"]["members"]), list(lib["CSSStyleDeclaration"]["extends"])
        while pending:
            parent = pending.pop()
            if parent in lib and parent not in self.bound:
                members |= lib[parent]["members"]
                pending += lib[parent]["extends"]
        declared = {"members": members}
        idl = {a.identifier for a in interface.attributes} | {g.identifier for g in interface.operation_groups}
        lines = self.members.setdefault(interface.identifier, [])
        cls = blink_class_name(interface)
        for name in sorted(declared["members"] - idl):
            if not re.fullmatch(r"[a-z][A-Za-z0-9]*", name) or name in ("length",):
                continue
            camel, dashed = f"CssName_{name}", f"CssProperty_{name}"
            self.statics.append(
                f"const blink::AtomicString& {camel}() {{\n"
                f"  DEFINE_STATIC_LOCAL(const blink::AtomicString, name, (\"{name}\"));\n  return name;\n}}\n"
                f"const blink::String& {dashed}() {{\n"
                f"  DEFINE_STATIC_LOCAL(const blink::String, name, (\"{self.dashed(name)}\"));\n  return name;\n}}")
            getter = Function(interface, f"nts_dom_CSSStyleDeclaration_get_{name}", [],
                              Result("const NtsStringView*", "StringView", "string"),
                              f"receiver->AnonymousNamedGetter({camel}())", False, False)
            value = Param("value", "const NtsBorrowedString* value", "value: StringView", "", True)
            setter = Function(interface, f"nts_dom_CSSStyleDeclaration_set_{name}", [value],
                              Result("void", "void", "void"),
                              f"receiver->setProperty(context.document->GetExecutionContext(), {dashed}(), "
                              f"NtsText(context, value).Text(), blink::g_empty_string, exception_state)",
                              True, True)  # the IDL's named setter is [CEReactions]
            self.functions += [getter, setter]
            lines.append(self.method_line(interface, f"_get_{name}", getter))
            lines.append(self.method_line(interface, f"_set_{name}", setter))
            lines.append(f"    /**\n     * @ntsGet _get_{name}\n     * @ntsSet _set_{name}\n     */\n    {name}: StringView;")

    # -- files -----------------------------------------------------------

    def parent(self, interface):
        inherited = interface.inherited
        while inherited is not None and inherited.identifier not in self.bound:
            inherited = inherited.inherited
        return inherited

    def adapter_function(self, function):
        c_params = ([f"{self.handle_tag(function.interface.identifier)}* self"] if function.receiver else []) + \
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
        if function.receiver and getattr(function, "local_window", False):
            lines.append(f"  auto* receiver = blink::To<blink::LocalDOMWindow>({self.node(function.interface, 'self')});")
        elif function.receiver:
            lines.append(f"  auto* receiver = {self.node(function.interface, 'self')};")
        preludes = [p.prelude for p in function.params if p.prelude]
        if preludes:
            # Converted before the call, as the binding converts arguments: a
            # conversion that fails is the exception, and Blink is not called.
            exceptions = "exception_state" if function.throws else "conversion"
            if not function.throws:
                lines.append("  blink::DummyExceptionStateForTesting conversion;")
            for prelude in preludes:
                lines.append("  " + prelude.replace("{exceptions}", exceptions))
            if function.throws:
                failed = "static_cast<blink::ExceptionState&>(exception_state).HadException()"
                lines.append(f"  if ({failed}) return{'' if function.result.kind == 'void' else ' {}'};")
        lines += ["  " + statement + ";" for statement in function.statements]
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

    def overlay(self):
        """`lib-dom-bindings.d.ts`: which nts:dom declaration implements each
        lib.dom.d.ts declaration a program may use (docs/lib-dom.md). The
        program is typed by lib.dom.d.ts and lowered against nts:dom; this
        file is the whole of the pairing, read by the compiler's binding step.

        An interface lib.dom.d.ts declares that Blink's core defines is bound
        by its own nts:dom type, or, if that is not generated, by its nearest
        generated ancestor's -- an HTMLDivElement is an HTMLElement handle
        with HTMLElement's members -- and carries its NtsDomInterface id, what
        `instanceof` against it asks nts_dom_is."""
        import libdom
        declared = libdom.interfaces(open(libdom.LIB_DOM).read())
        lines = []
        for interface in self.checkable:
            identifier = interface.identifier
            if identifier not in declared:
                continue
            bound = identifier if identifier in self.bound else next(
                (ancestor for ancestor in self.ancestors(interface) if ancestor in self.bound), None)
            tags = [f"@ntsIs nts_dom_is {self.interface_id[identifier]}"]
            if bound is not None:
                tags.insert(0, f'@ntsBoundBy "nts:dom" {bound}')
            lines.append("/**\n" + "".join(f" * {tag}\n" for tag in tags) + " */\n"
                         f"interface {identifier} {{}}")
        globals_ = [
            ("declare var document: Document;", "document"),
            ("declare function requestAnimationFrame(callback: FrameRequestCallback): number;", "requestAnimationFrame"),
            ("declare function cancelAnimationFrame(handle: number): void;", "cancelAnimationFrame"),
        ]
        for declaration, bound in globals_:
            lines.append(f'/** @ntsBoundBy "nts:dom" {bound} */\n{declaration}')
        return "\n".join(lines)

    def files(self):
        revision = self.allowlist.get("chromiumRevision", "")
        banner = (f"Generated by tooling/chromium/bindgen/generate.py from Blink's IDL at Chromium {revision}.\n"
                  "Do not edit; regenerate.")
        typedefs = "\n".join(f"typedef struct {self.handle_tag(i.identifier)} {self.handle_tag(i.identifier)};"
                             for i in self.interfaces)
        prototypes = []
        for function in self.functions:
            c_params = ([f"{self.handle_tag(function.interface.identifier)}* self"] if function.receiver else []) + \
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

/* Every interface Blink's core component defines, for nts_dom_is: bound or
 * not, since `instanceof` may name any of them. Stable for one Chromium pin
 * and allowlist. */
enum NtsDomInterface {{
{chr(10).join(f"  NTS_DOM_{i.identifier} = {n}," for n, i in enumerate(self.checkable))}
}};
/* `object instanceof <interface>`, as V8's binding answers it: whether the
 * object's wrapper type is the interface's or derives from it. NULL is no. */
bool nts_dom_is(const void* object, uint32_t interface_id);

{chr(10).join(prototypes)}

#ifdef __cplusplus
}}
#endif
#endif
"""
        headers = set(self.headers) | {PathManager(i).api_path(ext="h") for i in self.checkable}
        includes = "\n".join(f'#include "{path}"' for path in sorted(headers))
        adapter = f"""// {banner.replace(chr(10), chr(10) + '// ')}
#include "nts/dom_idl.h"

#include <array>

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
  NtsDomException** error_;  // STACK_ALLOCATED: no BackupRefPtr per call
}};
}}  // namespace

namespace {{
{(chr(10)).join(self.statics)}
}}  // namespace

// In Blink's namespace, as the bindings are: bind_gen's expressions name
// Blink's own (`html_names::kClassAttr`). The symbols are C's either way.
// What `instanceof` checks against, by NtsDomInterface id: each interface's
// wrapper type, which knows its parent's.
constexpr std::array<const blink::WrapperTypeInfo*, {len(self.checkable)}> kInterfaces = {{
{chr(10).join(f"    blink::{v8_bridge_class_name(i)}::GetWrapperTypeInfo()," for i in self.checkable)}
}};

// In Blink's namespace, as the bindings are: bind_gen's expressions name
// Blink's own (`html_names::kClassAttr`). The symbols are C's either way.
namespace blink {{
extern "C" {{
bool nts_dom_is(const void* object, uint32_t interface_id) {{
  CHECK_LT(interface_id, kInterfaces.size());
  // As ScriptWrappable::TypeDispatcher::DowncastTo checks: by the IDL.
  return object && ToWrapperTypeInfo(WrappableOf(object))->IsSubclass(kInterfaces[interface_id]);
}}

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
            for made in (f for f in self.functions if getattr(f, "constructs", None) is interface):
                notes = [f"@ntsSymbol {made.symbol}"] + (list(THROWS) if made.throws else [])
                params = [p.ts for p in made.params] + ([ERROR_TS] if made.throws else [])
                types.append("  /**\n" + "".join(f"   * {note}\n" for note in notes) + "   */")
                types.append(f"  export function new{identifier}({', '.join(params)}): {identifier};")
        declarations = f"""// {banner.replace(chr(10), chr(10) + '// ')}
/** @ntsHeader "dom_idl.h" */
declare module "nts:dom" {{
  import type {{ Closure, CNumber, HostClass, Opaque, Ptr, StringView }} from "c:types";
  /** A DOM exception a member reported, thrown as an `Error` "Name: message". */
  export type DOMException = Opaque<"NtsDomException">;
{chr(10).join(types)}
}}
"""
        overlay = f"""// {banner.replace(chr(10), chr(10) + '// ')}
//
// What implements lib.dom.d.ts's declarations natively: each names the
// nts:dom declaration a use of it lowers to (docs/lib-dom.md). Declarations
// only -- lib.dom.d.ts types the program; nothing here changes a type.

{self.overlay()}
"""
        report = {"bound": len(self.functions), "skipped": self.skipped}
        return {
            os.path.join(LANE, "dom", "abi", "dom_idl.h"): header,
            os.path.join(LANE, "adapter", "dom_idl.cc"): adapter,
            os.path.join(LANE, "dom", "types", "dom-idl.d.ts"): declarations,
            os.path.join(LANE, "dom", "types", "lib-dom-bindings.d.ts"): overlay,
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
