import { requireArguments, requireDictionary } from "../core/webidl.ts";

export type QueuingStrategySize<T> = (chunk: T) => number;

export interface QueuingStrategy<T> {
  highWaterMark?: number;
  size?: QueuingStrategySize<T>;
}

export interface QueuingStrategyInit {
  highWaterMark: number;
}

const defaultSize = (_chunk: unknown): number => 1;

export function extractHighWaterMark<T>(
  strategy: QueuingStrategy<T> | null,
  defaultHighWaterMark: number,
): number {
  requireDictionary(strategy, "Queuing strategy");
  if (strategy === null) {
    return defaultHighWaterMark;
  }
  const highWaterMark = strategy.highWaterMark;
  if (highWaterMark === undefined) {
    return defaultHighWaterMark;
  }
  const convertedHighWaterMark = +highWaterMark;
  if (Number.isNaN(convertedHighWaterMark) || convertedHighWaterMark < 0) {
    throw new RangeError("Invalid highWaterMark");
  }
  return convertedHighWaterMark;
}

export function extractSizeAlgorithm<T>(
  strategy: QueuingStrategy<T> | null,
): QueuingStrategySize<T> {
  requireDictionary(strategy, "Queuing strategy");
  if (strategy === null) {
    return defaultSize;
  }
  const size = strategy.size;
  if (size === undefined) {
    return defaultSize;
  }
  if (typeof size !== "function") {
    throw new TypeError("Queuing strategy size must be callable");
  }
  return size;
}

export function convertQueuingStrategyHighWaterMark(
  args: [init?: QueuingStrategyInit],
  constructorName: string,
): number {
  requireArguments(args, 1, constructorName + " constructor");
  const init = args[0];
  if (
    init === null ||
    init === undefined ||
    (typeof init !== "object" && typeof init !== "function")
  ) {
    throw new TypeError(constructorName + " init must be a dictionary");
  }
  if (!("highWaterMark" in init)) {
    throw new TypeError(constructorName + " init.highWaterMark is required");
  }
  return +init.highWaterMark;
}
