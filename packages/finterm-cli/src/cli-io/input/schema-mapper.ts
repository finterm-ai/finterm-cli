/**
 * Schema-to-CLI option mapper.
 *
 * Maps Zod schemas to CLI option specifications for consistent
 * command-line argument handling.
 *
 * Mapping rules:
 * - string (required) → Positional arg
 * - string (optional) → --option value
 * - string[] → --option a,b,c or positional variadic
 * - number → --option value
 * - enum → --option value (choices shown in help)
 * - boolean → --flag
 * - object/union → Complex type (requires file input)
 *
 * Supports Zod 4.x API structure.
 */

import type { z } from 'zod';

/** CLI option types */
export type CLIOptionType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'union'
  | 'unknown';

/** CLI option specification */
export interface CLIOptionSpec {
  /** Field name from schema */
  name: string;
  /** Base type of the option */
  type: CLIOptionType;
  /** Whether the field is required */
  required: boolean;
  /** Whether the field is an array */
  isArray: boolean;
  /** Description from schema */
  description?: string;
  /** Enum choices if applicable */
  choices?: string[];
  /** Default value if specified */
  defaultValue?: unknown;
}

// Zod 4.x type introspection.
//
// Zod does not expose a stable public reflection API, so this module reads the
// internal `_def` structure directly to derive CLI option shapes from a schema.
// Centralizing those reads here keeps the version-specific assumptions in one
// place.

/** Internal Zod 4.x definition type */
interface ZodDef {
  type?: string; // In Zod 4.x: "string", "number", "array", "optional", etc.
  innerType?: z.ZodTypeAny; // For optional/nullable/default wrappers
  element?: z.ZodTypeAny; // For arrays, the element type
  entries?: Record<string, string>; // For enums: {a: "a", b: "b"}
  options?: z.ZodTypeAny[]; // For unions
  shape?: Record<string, z.ZodTypeAny>; // For objects (direct in Zod 4.x)
  defaultValue?: unknown; // For defaults (direct value in Zod 4.x)
}

/**
 * Get the Zod definition.
 */
function getDef(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def || {};
}

/**
 * Get the type string from a Zod 4.x schema definition.
 * In Zod 4.x, the type is stored as a string like "string", "number", etc.
 */
function getDefType(schema: z.ZodTypeAny): string | undefined {
  const def = getDef(schema);
  return def.type;
}

/**
 * Map a Zod schema to its CLI option type, unwrapping optional/nullable/default
 * wrappers first so the base type drives the mapping.
 */
export function getZodTypeName(schema: z.ZodTypeAny): CLIOptionType {
  const unwrapped = unwrapSchema(schema);
  const typeName = getDefType(unwrapped);

  switch (typeName) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'enum':
      return 'enum';
    case 'object':
      return 'object';
    case 'union':
      return 'union';
    default:
      return 'unknown';
  }
}

/**
 * Unwrap a schema to get to the base type.
 * Strips optional, nullable, default wrappers (Zod 4.x).
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    const def = getDef(current);
    const typeName = def.type;

    if (typeName === 'optional' || typeName === 'nullable' || typeName === 'default') {
      const innerType = def.innerType;
      if (innerType) {
        current = innerType;
      } else {
        break;
      }
    } else {
      break;
    }
    iterations++;
  }

  return current;
}

/**
 * Whether a field may be omitted from CLI input. A `default` wrapper counts as
 * optional because the schema supplies a value when the user omits the flag.
 */
export function isOptionalField(schema: z.ZodTypeAny): boolean {
  const typeName = getDefType(schema);

  if (typeName === 'optional' || typeName === 'nullable' || typeName === 'default') {
    return true;
  }

  return false;
}

/**
 * Get a field's `.describe()` text, falling back to the unwrapped inner schema
 * since a description may be attached either to the wrapper or to the base type.
 */
export function getSchemaDescription(schema: z.ZodTypeAny): string | undefined {
  const directDesc = (schema as unknown as { description?: string }).description;
  if (directDesc) {
    return directDesc;
  }

  const unwrapped = unwrapSchema(schema);
  return (unwrapped as unknown as { description?: string }).description;
}

/**
 * Get enum values from a ZodEnum schema (Zod 4.x).
 */
function getEnumValues(schema: z.ZodTypeAny): string[] | undefined {
  const unwrapped = unwrapSchema(schema);
  const def = getDef(unwrapped);

  if (def.type === 'enum' && def.entries) {
    // In Zod 4.x, entries is an object like { a: 'a', b: 'b' }
    return Object.keys(def.entries);
  }
  return undefined;
}

/**
 * Get default value from a schema (Zod 4.x).
 */
function getDefaultValue(schema: z.ZodTypeAny): unknown {
  const def = getDef(schema);

  if (def.type === 'default' && def.defaultValue !== undefined) {
    // In Zod 4.x, defaultValue is stored directly (not as a function)
    return def.defaultValue;
  }
  return undefined;
}

/**
 * Get the element type of an array schema (Zod 4.x).
 */
function getArrayElementType(schema: z.ZodTypeAny): CLIOptionType {
  const unwrapped = unwrapSchema(schema);
  const def = getDef(unwrapped);

  if (def.type === 'array' && def.element) {
    return getZodTypeName(def.element);
  }
  return 'unknown';
}

/**
 * Map every field of a Zod object schema to a CLI option specification, the
 * single source the parser and help generator both consume.
 */
export function mapSchemaToOptions(schema: z.ZodObject<z.ZodRawShape>): CLIOptionSpec[] {
  const def = getDef(schema);
  let shape: Record<string, z.ZodTypeAny> = {};

  // In Zod 4.x the shape lives directly on _def.shape; fall back to the public
  // `.shape` accessor if that internal layout ever changes.
  if (def.shape && typeof def.shape === 'object') {
    shape = def.shape;
  } else {
    const directShape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
    if (directShape && typeof directShape === 'object') {
      shape = directShape;
    }
  }

  const options: CLIOptionSpec[] = [];

  for (const [name, fieldSchema] of Object.entries(shape)) {
    const option = mapFieldToOption(name, fieldSchema);
    options.push(option);
  }

  return options;
}

/**
 * Map a single field to a CLI option specification.
 */
function mapFieldToOption(name: string, schema: z.ZodTypeAny): CLIOptionSpec {
  const typeName = getZodTypeName(schema);
  const isOptional = isOptionalField(schema);
  const description = getSchemaDescription(schema);
  const defaultValue = getDefaultValue(schema);

  if (typeName === 'array') {
    const elementType = getArrayElementType(schema);
    return {
      name,
      type: elementType,
      required: !isOptional,
      isArray: true,
      description,
      choices: undefined,
      defaultValue,
    };
  }

  if (typeName === 'enum') {
    const choices = getEnumValues(schema);
    return {
      name,
      type: 'enum',
      required: !isOptional,
      isArray: false,
      description,
      choices,
      defaultValue,
    };
  }

  return {
    name,
    type: typeName,
    required: !isOptional,
    isArray: false,
    description,
    choices: undefined,
    defaultValue,
  };
}
