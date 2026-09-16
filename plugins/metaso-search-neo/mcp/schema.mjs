import { MetasoError } from "./metaso-client.mjs";

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  return typeof value;
}

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "array") return Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "null") return value === null;
    return typeof value === type;
  });
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function schemaErrors(schema, value, path = "arguments") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => schemaErrors(branch, value, path).length === 0);
    if (matches.length !== 1) errors.push(`${path} must match exactly one allowed shape`);
  }
  if (schema.not && schemaErrors(schema.not, value, path).length === 0) {
    errors.push(`${path} matches a forbidden shape`);
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.filter((branch) => schemaErrors(branch, value, path).length === 0);
    if (matches.length === 0) errors.push(`${path} must match at least one allowed shape`);
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}; got ${valueType(value)}`);
    return errors;
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} character(s)`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) errors.push(`${path} must contain unique items`);
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...schemaErrors(schema.items, item, `${path}[${index}]`)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(child, value[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
  return errors;
}

export function validateToolArguments(tool, value) {
  const errors = schemaErrors(tool.inputSchema, value);
  if (errors.length) {
    throw new MetasoError("Tool arguments failed schema validation", {
      channel: "validation",
      code: "SCHEMA_VALIDATION_FAILED",
      details: { errors: errors.slice(0, 20) },
    });
  }
}
