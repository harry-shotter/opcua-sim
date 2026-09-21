import { DataType, NodeId, Variant, type UAObjectType } from "node-opcua";
import {
  ContentFilter,
  ElementOperand,
  FilterOperator,
  LiteralOperand,
  SimpleAttributeOperand
} from "node-opcua-service-filter";

/** Resolves a select operand against the event record being tested. */
export type FieldResolver = (operand: SimpleAttributeOperand) => Variant;

/** Number of operands each supported operator expects, -1 meaning variadic. */
const operandCounts: Partial<Record<FilterOperator, number>> = {
  [FilterOperator.Equals]: 2,
  [FilterOperator.LessThan]: 2,
  [FilterOperator.GreaterThan]: 2,
  [FilterOperator.LessThanOrEqual]: 2,
  [FilterOperator.GreaterThanOrEqual]: 2,
  [FilterOperator.Like]: 2,
  [FilterOperator.And]: 2,
  [FilterOperator.Or]: 2,
  [FilterOperator.Not]: 1,
  [FilterOperator.IsNull]: 1,
  [FilterOperator.OfType]: 1,
  [FilterOperator.InList]: -1
};

/**
 * Checks a where clause can be evaluated before any record is tested. A filter
 * the server cannot honour has to be rejected outright rather than silently
 * returning the wrong events.
 */
export function isWhereClauseSupported(
  filter: ContentFilter | null | undefined
): boolean {
  const elements = filter?.elements ?? [];

  return elements.every((element, index) => {
    const expected = operandCounts[element.filterOperator];

    if (expected === undefined) {
      return false;
    }

    const operands = element.filterOperands ?? [];

    if (expected === -1 ? operands.length < 2 : operands.length !== expected) {
      return false;
    }

    return operands.every((operand) => {
      if (operand instanceof ElementOperand) {
        // forward references only, which also rules out evaluation cycles
        return operand.index > index && operand.index < elements.length;
      }

      return (
        operand instanceof LiteralOperand ||
        operand instanceof SimpleAttributeOperand
      );
    });
  });
}

/**
 * Evaluates a where clause against a single record. Element zero is the root of
 * the filter; an unknown or unresolvable field yields null, which never passes.
 */
export function matchesWhereClause(
  filter: ContentFilter | null | undefined,
  resolve: FieldResolver,
  eventType: UAObjectType
): boolean {
  const elements = filter?.elements ?? [];

  if (elements.length === 0) {
    return true;
  }

  return evaluate(0) === true;

  function evaluate(index: number): boolean | null {
    const element = elements[index];

    if (element === undefined) {
      return null;
    }

    const operands = element.filterOperands ?? [];
    const operand = (position: number) => valueOf(operands[position]);

    switch (element.filterOperator) {
      case FilterOperator.Equals:
        return equals(compare(operand(0), operand(1)), 0);

      case FilterOperator.LessThan:
        return lessThan(compare(operand(0), operand(1)), 0);

      case FilterOperator.GreaterThan:
        return greaterThan(compare(operand(0), operand(1)));

      case FilterOperator.LessThanOrEqual:
        return notGreaterThan(compare(operand(0), operand(1)));

      case FilterOperator.GreaterThanOrEqual:
        return notLessThan(compare(operand(0), operand(1)));

      case FilterOperator.Like:
        return like(operand(0), operand(1));

      case FilterOperator.IsNull:
        return operand(0) === null;

      case FilterOperator.Not: {
        const value = asBoolean(operands[0]);
        return value === null ? null : !value;
      }

      case FilterOperator.And:
        return and(asBoolean(operands[0]), asBoolean(operands[1]));

      case FilterOperator.Or:
        return or(asBoolean(operands[0]), asBoolean(operands[1]));

      case FilterOperator.InList: {
        const target = operand(0);
        const candidates = operands
          .slice(1)
          .map((_, position) => operand(position + 1));

        if (target === null) {
          return null;
        }

        return candidates.some(
          (candidate) => compare(target, candidate) === 0
        );
      }

      case FilterOperator.OfType:
        return isOfType(operand(0), eventType);
    }

    return null;
  }

  /** Reads an operand as a value, recursing into nested filter elements. */
  function valueOf(operand: unknown): Comparable {
    if (operand instanceof ElementOperand) {
      return evaluate(operand.index);
    }

    if (operand instanceof LiteralOperand) {
      return comparable(operand.value);
    }

    if (operand instanceof SimpleAttributeOperand) {
      return comparable(resolve(operand));
    }

    return null;
  }

  function asBoolean(operand: unknown): boolean | null {
    const value = valueOf(operand);

    return typeof value === "boolean" ? value : null;
  }
}

type Comparable = string | number | boolean | null;

/**
 * Reduces a Variant to a value that can be compared with another. The BadNoData
 * placeholder the historian uses for absent fields becomes null so that it is
 * treated as missing rather than as a status code.
 */
function comparable(variant: Variant | undefined): Comparable {
  if (variant === undefined || variant.dataType === DataType.StatusCode) {
    return null;
  }

  const value = variant.value;

  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (value instanceof NodeId) {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("hex");
  }

  if (typeof value === "object" && "text" in value) {
    // LocalizedText compares on its text, matching what a client sees
    return (value as { text: string | null }).text ?? null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return null;
}

/** Orders two values, or null when either is missing. */
function compare(left: Comparable, right: Comparable): number | null {
  if (left === null || right === null) {
    return null;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  const [a, b] = [String(left), String(right)];

  return a < b ? -1 : a > b ? 1 : 0;
}

function equals(order: number | null, target: number): boolean | null {
  return order === null ? null : order === target;
}

function lessThan(order: number | null, target: number): boolean | null {
  return order === null ? null : order < target;
}

function greaterThan(order: number | null): boolean | null {
  return order === null ? null : order > 0;
}

function notGreaterThan(order: number | null): boolean | null {
  return order === null ? null : order <= 0;
}

function notLessThan(order: number | null): boolean | null {
  return order === null ? null : order >= 0;
}

function and(left: boolean | null, right: boolean | null): boolean | null {
  if (left === false || right === false) {
    return false;
  }

  return left === null || right === null ? null : true;
}

function or(left: boolean | null, right: boolean | null): boolean | null {
  if (left === true || right === true) {
    return true;
  }

  return left === null || right === null ? null : false;
}

/**
 * OPC UA pattern matching: `%` stands for any run of characters, `_` for a
 * single one, and `\` escapes either.
 */
function like(value: Comparable, pattern: Comparable): boolean | null {
  if (value === null || pattern === null) {
    return null;
  }

  let expression = "";

  for (let index = 0; index < String(pattern).length; index++) {
    const character = String(pattern)[index]!;

    if (character === "\\") {
      index++;
      const escaped = String(pattern)[index];
      expression += escaped === undefined ? "" : escapeRegExp(escaped);
      continue;
    }

    if (character === "%") {
      expression += ".*";
      continue;
    }

    if (character === "_") {
      expression += ".";
      continue;
    }

    expression += escapeRegExp(character);
  }

  return new RegExp(`^${expression}$`, "s").test(String(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the record's event type is the requested type or derives from it. */
function isOfType(value: Comparable, eventType: UAObjectType): boolean | null {
  if (value === null) {
    return null;
  }

  const wanted = String(value);

  for (
    let type: UAObjectType | null = eventType;
    type;
    type = (type.subtypeOfObj as UAObjectType | null) ?? null
  ) {
    if (type.nodeId.toString() === wanted) {
      return true;
    }
  }

  return false;
}
