// `util.parseArgs`, from node v24.20.0
// `lib/internal/util/parse_args/{parse_args,utils}.js`.

import {
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE,
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL,
  ERR_PARSE_ARGS_UNKNOWN_OPTION,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
} from "../../internal/errors.ts";
import {
  validateBoolean,
  validateBooleanArray,
  validateString,
  validateStringArray,
  validateUnion,
} from "../../internal/validators.ts";

declare function nts_process_argv(): string[];

export type ParseArgsOptionsType = "boolean" | "string";
type ParseArgsOptionValue = string | boolean;
type ParseArgsOptionValues = ParseArgsOptionValue[];

export interface ParseArgsOptionDescriptor {
  type: ParseArgsOptionsType;
  multiple?: boolean | undefined;
  short?: string | undefined;
  default?: string | boolean | string[] | boolean[] | undefined;
}

export interface ParseArgsOptionsConfig {
  [longOption: string]: ParseArgsOptionDescriptor;
}

export interface ParseArgsConfig {
  args?: readonly string[] | undefined;
  options?: ParseArgsOptionsConfig | undefined;
  strict?: boolean | undefined;
  allowPositionals?: boolean | undefined;
  allowNegative?: boolean | undefined;
  tokens?: boolean | undefined;
}

type ParseArgsOptionToken =
  | {
      kind: "option";
      index: number;
      name: string;
      rawName: string;
      value: string;
      inlineValue: boolean;
    }
  | {
      kind: "option";
      index: number;
      name: string;
      rawName: string;
      value: undefined;
      inlineValue: undefined;
    };

interface ParseArgsPositionalToken {
  kind: "positional";
  index: number;
  value: string;
}

interface ParseArgsOptionTerminatorToken {
  kind: "option-terminator";
  index: number;
}

type ParseArgsToken =
  | ParseArgsOptionToken
  | ParseArgsPositionalToken
  | ParseArgsOptionTerminatorToken;

interface ParseArgsResult {
  values: Record<string, ParseArgsOptionValue | ParseArgsOptionValues | undefined>;
  positionals: string[];
  tokens?: ParseArgsToken[] | undefined;
}

type IfDefaultsTrue<Value, WhenTrue, WhenFalse> = Value extends true
  ? WhenTrue
  : Value extends false
    ? WhenFalse
    : WhenTrue;

type IfDefaultsFalse<Value, WhenTrue, WhenFalse> = Value extends false
  ? WhenFalse
  : Value extends true
    ? WhenTrue
    : WhenFalse;

type ExtractOptionValue<
  Config extends ParseArgsConfig,
  Option extends ParseArgsOptionDescriptor,
> = IfDefaultsTrue<
  Config["strict"],
  Option["type"] extends "string"
    ? string
    : Option["type"] extends "boolean"
      ? boolean
      : string | boolean,
  string | boolean
>;

type ApplyOptionalModifiers<
  Options extends ParseArgsOptionsConfig,
  Values extends Record<keyof Options, unknown>,
> = {
  -readonly [LongOption in keyof Options]?: Values[LongOption];
} & {
  [
    LongOption in keyof Options as Options[LongOption]["default"] extends {} ? LongOption : never
  ]: Values[LongOption];
};

type ParsedValues<Config extends ParseArgsConfig> = IfDefaultsTrue<
  Config["strict"],
  unknown,
  Record<string, string | boolean | undefined>
> &
  (Config["options"] extends ParseArgsOptionsConfig
    ? ApplyOptionalModifiers<
        Config["options"],
        {
          [LongOption in keyof Config["options"]]: IfDefaultsFalse<
            Config["options"][LongOption]["multiple"],
            Array<ExtractOptionValue<Config, Config["options"][LongOption]>>,
            ExtractOptionValue<Config, Config["options"][LongOption]>
          >;
        }
      >
    : {});

type ParsedPositionals<Config extends ParseArgsConfig> = IfDefaultsTrue<
  Config["strict"],
  IfDefaultsFalse<Config["allowPositionals"], string[], []>,
  IfDefaultsTrue<Config["allowPositionals"], string[], []>
>;

type PreciseOptionToken<
  Name extends string,
  Option extends ParseArgsOptionDescriptor,
> = Option["type"] extends "string"
  ? ParseArgsOptionToken & { name: Name; value: string; inlineValue: boolean }
  : Option["type"] extends "boolean"
    ? ParseArgsOptionToken & {
        name: Name;
        value: undefined;
        inlineValue: undefined;
      }
    : ParseArgsOptionToken & { name: Name };

type TokenForOptions<
  Config extends ParseArgsConfig,
  Name extends keyof Config["options"] = keyof Config["options"],
> = Name extends unknown
  ? Config["options"] extends ParseArgsOptionsConfig
    ? PreciseOptionToken<Name & string, Config["options"][Name]>
    : ParseArgsOptionToken
  : never;

type ParsedOptionToken<Config extends ParseArgsConfig> = IfDefaultsTrue<
  Config["strict"],
  TokenForOptions<Config>,
  ParseArgsOptionToken
>;

type ParsedPositionalToken<Config extends ParseArgsConfig> = IfDefaultsTrue<
  Config["strict"],
  IfDefaultsFalse<Config["allowPositionals"], ParseArgsPositionalToken, never>,
  IfDefaultsTrue<Config["allowPositionals"], ParseArgsPositionalToken, never>
>;

type ParsedTokens<Config extends ParseArgsConfig> = Array<
  ParsedOptionToken<Config> | ParsedPositionalToken<Config> | ParseArgsOptionTerminatorToken
>;

type PreciseParsedResults<Config extends ParseArgsConfig> = IfDefaultsFalse<
  Config["tokens"],
  {
    values: ParsedValues<Config>;
    positionals: ParsedPositionals<Config>;
    tokens: ParsedTokens<Config>;
  },
  {
    values: ParsedValues<Config>;
    positionals: ParsedPositionals<Config>;
  }
>;

type ParsedResults<Config extends ParseArgsConfig> = ParseArgsConfig extends Config
  ? ParseArgsResult
  : PreciseParsedResults<Config>;

type OptionDefault = string | boolean | string[] | boolean[];

interface NormalizedOptionDescriptor {
  type: ParseArgsOptionsType;
  multiple: boolean;
  short: string | undefined;
  defaultValue: OptionDefault | undefined;
}

interface NormalizedOptions {
  byLong: Map<string, NormalizedOptionDescriptor>;
  byShort: Map<string, string>;
  names: string[];
}

interface RuntimeParseConfig {
  strict: boolean;
  allowPositionals: boolean;
  allowNegative: boolean;
  options: NormalizedOptions;
}

function validateRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
  }
}

function ownValue(record: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

function normalizeOptions(value: unknown): NormalizedOptions {
  const byLong = new Map<string, NormalizedOptionDescriptor>();
  const byShort = new Map<string, string>();
  const names: string[] = [];
  if (value === undefined) return { byLong, byShort, names };

  validateRecord(value, "options");
  for (const longOption of Object.keys(value)) {
    const rawDescriptor = value[longOption];
    const descriptorName = `options.${longOption}`;
    validateRecord(rawDescriptor, descriptorName);

    const type = ownValue(rawDescriptor, "type");
    validateUnion(type, `${descriptorName}.type`, ["string", "boolean"]);

    const shortValue = ownValue(rawDescriptor, "short");
    if (shortValue !== undefined) {
      validateString(shortValue, `${descriptorName}.short`);
      if (shortValue.length !== 1) {
        throw new ERR_INVALID_ARG_VALUE(
          `${descriptorName}.short`,
          shortValue,
          "must be a single character",
        );
      }
    }

    const multipleValue = ownValue(rawDescriptor, "multiple");
    if (multipleValue !== undefined) {
      validateBoolean(multipleValue, `${descriptorName}.multiple`);
    }
    const multiple = multipleValue ?? false;

    const defaultValue = ownValue(rawDescriptor, "default");
    if (defaultValue !== undefined) {
      if (type === "string") {
        if (multiple) validateStringArray(defaultValue, `${descriptorName}.default`);
        else validateString(defaultValue, `${descriptorName}.default`);
      } else if (multiple) {
        validateBooleanArray(defaultValue, `${descriptorName}.default`);
      } else {
        validateBoolean(defaultValue, `${descriptorName}.default`);
      }
    }

    byLong.set(longOption, {
      type,
      multiple,
      short: shortValue,
      defaultValue,
    });
    names.push(longOption);
    if (shortValue !== undefined && !byShort.has(shortValue)) {
      byShort.set(shortValue, longOption);
    }
  }
  return { byLong, byShort, names };
}

function getMainArgs(): string[] {
  // A compiled NTS executable has neither `--eval` nor `--print`: argv[0] is
  // the executable and argv[1] is the program, exactly as in Node's file mode.
  return nts_process_argv().slice(2);
}

function optionForShort(shortOption: string, options: NormalizedOptions): string {
  return options.byShort.get(shortOption) ?? shortOption;
}

function optionType(
  longOption: string,
  options: NormalizedOptions,
): ParseArgsOptionsType | undefined {
  return options.byLong.get(longOption)?.type;
}

function optionToken(
  name: string,
  rawName: string,
  index: number,
  value?: string,
  inlineValue?: boolean,
): ParseArgsOptionToken {
  if (value === undefined) {
    return { kind: "option", name, rawName, index, value, inlineValue: undefined };
  }
  return {
    kind: "option",
    name,
    rawName,
    index,
    value,
    inlineValue: inlineValue ?? false,
  };
}

/** Identify arguments without shifting or unshifting the caller's array. */
function argsToTokens(args: readonly string[], options: NormalizedOptions): ParseArgsToken[] {
  const tokens: ParseArgsToken[] = [];

  for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex++) {
    const argument = args[argumentIndex];
    if (argument === undefined) continue;

    if (argument === "--") {
      tokens.push({ kind: "option-terminator", index: argumentIndex });
      for (let index = argumentIndex + 1; index < args.length; index++) {
        const positional = args[index];
        if (positional !== undefined) {
          tokens.push({ kind: "positional", index, value: positional });
        }
      }
      break;
    }

    if (argument.length === 2 && argument.charAt(0) === "-" && argument.charAt(1) !== "-") {
      const shortOption = argument.charAt(1);
      const longOption = optionForShort(shortOption, options);
      const nextArgument = args[argumentIndex + 1];
      if (optionType(longOption, options) === "string" && nextArgument !== undefined) {
        tokens.push(optionToken(longOption, argument, argumentIndex, nextArgument, false));
        argumentIndex++;
      } else {
        tokens.push(optionToken(longOption, argument, argumentIndex));
      }
      continue;
    }

    const shortGroup =
      argument.length > 2 &&
      argument.charAt(0) === "-" &&
      argument.charAt(1) !== "-" &&
      optionType(optionForShort(argument.charAt(1), options), options) !== "string";
    if (shortGroup) {
      for (let offset = 1; offset < argument.length; offset++) {
        const shortOption = argument.charAt(offset);
        const longOption = optionForShort(shortOption, options);
        const rawName = `-${shortOption}`;
        if (optionType(longOption, options) !== "string") {
          tokens.push(optionToken(longOption, rawName, argumentIndex));
          continue;
        }

        if (offset < argument.length - 1) {
          tokens.push(
            optionToken(longOption, rawName, argumentIndex, argument.slice(offset + 1), true),
          );
        } else {
          const nextArgument = args[argumentIndex + 1];
          if (nextArgument === undefined) {
            tokens.push(optionToken(longOption, rawName, argumentIndex));
          } else {
            tokens.push(optionToken(longOption, rawName, argumentIndex, nextArgument, false));
            argumentIndex++;
          }
        }
        break;
      }
      continue;
    }

    if (argument.length > 2 && argument.startsWith("--") && !argument.includes("=", 3)) {
      const longOption = argument.slice(2);
      const nextArgument = args[argumentIndex + 1];
      if (optionType(longOption, options) === "string" && nextArgument !== undefined) {
        tokens.push(optionToken(longOption, argument, argumentIndex, nextArgument, false));
        argumentIndex++;
      } else {
        tokens.push(optionToken(longOption, argument, argumentIndex));
      }
      continue;
    }

    if (argument.length > 2 && argument.startsWith("--") && argument.includes("=", 3)) {
      const equalIndex = argument.indexOf("=");
      const longOption = argument.slice(2, equalIndex);
      tokens.push(
        optionToken(
          longOption,
          `--${longOption}`,
          argumentIndex,
          argument.slice(equalIndex + 1),
          true,
        ),
      );
      continue;
    }

    // The first short option is string-valued, so everything after its short
    // name is the inline value rather than a group of boolean options.
    if (argument.length > 2 && argument.charAt(0) === "-" && argument.charAt(1) !== "-") {
      const shortOption = argument.charAt(1);
      const longOption = optionForShort(shortOption, options);
      tokens.push(
        optionToken(longOption, `-${shortOption}`, argumentIndex, argument.slice(2), true),
      );
      continue;
    }

    tokens.push({ kind: "positional", index: argumentIndex, value: argument });
  }

  return tokens;
}

function checkOptionLikeValue(token: ParseArgsOptionToken): void {
  if (
    token.inlineValue !== true &&
    token.value !== undefined &&
    token.value.length > 1 &&
    token.value.charAt(0) === "-"
  ) {
    const example = token.rawName.startsWith("--")
      ? `'${token.rawName}=-XYZ'`
      : `'--${token.name}=-XYZ' or '${token.rawName}-XYZ'`;
    throw new ERR_PARSE_ARGS_INVALID_OPTION_VALUE(
      `Option '${token.rawName}' argument is ambiguous.\n` +
        `Did you forget to specify the option argument for '${token.rawName}'?\n` +
        `To specify an option argument starting with a dash use ${example}.`,
    );
  }
}

function checkOptionUsage(config: RuntimeParseConfig, token: ParseArgsOptionToken): void {
  let longOption = token.name;
  let descriptor = config.options.byLong.get(longOption);
  if (descriptor === undefined) {
    if (config.allowNegative && longOption.startsWith("no-")) {
      longOption = longOption.slice(3);
      descriptor = config.options.byLong.get(longOption);
    }
    if (descriptor === undefined || descriptor.type !== "boolean") {
      throw new ERR_PARSE_ARGS_UNKNOWN_OPTION(token.rawName, config.allowPositionals);
    }
  }

  const names =
    descriptor.short === undefined ? `--${longOption}` : `-${descriptor.short}, --${longOption}`;
  if (descriptor.type === "string" && token.value === undefined) {
    throw new ERR_PARSE_ARGS_INVALID_OPTION_VALUE(`Option '${names} <value>' argument missing`);
  }
  if (descriptor.type === "boolean" && token.value !== undefined) {
    throw new ERR_PARSE_ARGS_INVALID_OPTION_VALUE(`Option '${names}' does not take an argument`);
  }
}

function storeOption(
  token: ParseArgsOptionToken,
  options: NormalizedOptions,
  values: ParseArgsResult["values"],
  allowNegative: boolean,
): void {
  let longOption = token.name;
  let value: ParseArgsOptionValue = token.value ?? true;
  if (longOption === "__proto__") return;

  if (allowNegative && longOption.startsWith("no-") && token.value === undefined) {
    longOption = longOption.slice(3);
    token.name = longOption;
    value = false;
  }

  if (options.byLong.get(longOption)?.multiple === true) {
    const current = Object.hasOwn(values, longOption) ? values[longOption] : undefined;
    if (Array.isArray(current)) current.push(value);
    else values[longOption] = [value];
  } else {
    values[longOption] = value;
  }
}

function storeDefaults(options: NormalizedOptions, values: ParseArgsResult["values"]): void {
  for (const longOption of options.names) {
    if (longOption === "__proto__" || Object.hasOwn(values, longOption)) continue;
    const defaultValue = options.byLong.get(longOption)?.defaultValue;
    if (defaultValue !== undefined) values[longOption] = defaultValue;
  }
}

export function parseArgs<const Config extends ParseArgsConfig>(
  config?: Config,
): ParsedResults<Config>;
export function parseArgs(config: unknown = {}): ParseArgsResult {
  if (config === null) {
    // Upstream reaches Object.prototype.hasOwnProperty before its first
    // validator, and this is that intrinsic's stable null error.
    throw new TypeError("Cannot convert undefined or null to object");
  }
  validateRecord(config, "config");

  const argsValue = ownValue(config, "args") ?? getMainArgs();
  validateStringArray(argsValue, "args");

  const strictValue = ownValue(config, "strict") ?? true;
  validateBoolean(strictValue, "strict");
  const allowPositionalsValue = ownValue(config, "allowPositionals") ?? !strictValue;
  validateBoolean(allowPositionalsValue, "allowPositionals");
  const returnTokensValue = ownValue(config, "tokens") ?? false;
  validateBoolean(returnTokensValue, "tokens");
  const allowNegativeValue = ownValue(config, "allowNegative") ?? false;
  validateBoolean(allowNegativeValue, "allowNegative");
  const options = normalizeOptions(ownValue(config, "options"));

  const runtimeConfig: RuntimeParseConfig = {
    strict: strictValue,
    allowPositionals: allowPositionalsValue,
    allowNegative: allowNegativeValue,
    options,
  };
  const tokens = argsToTokens(argsValue, options);
  const values: ParseArgsResult["values"] = {};
  const positionals: string[] = [];

  for (const token of tokens) {
    if (token.kind === "option") {
      if (runtimeConfig.strict) {
        checkOptionUsage(runtimeConfig, token);
        checkOptionLikeValue(token);
      }
      storeOption(token, options, values, runtimeConfig.allowNegative);
    } else if (token.kind === "positional") {
      if (!runtimeConfig.allowPositionals) {
        throw new ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL(token.value);
      }
      positionals.push(token.value);
    }
  }

  storeDefaults(options, values);
  return returnTokensValue ? { values, positionals, tokens } : { values, positionals };
}
