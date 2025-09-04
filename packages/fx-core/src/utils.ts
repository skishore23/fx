import crypto from "crypto";

/**
 * Essential utilities for the Fx framework
 * Simplified and focused on core functionality
 */

/**
 * Generates a new UUID v4 string
 */
export const newId = (): string => {
  return crypto.randomUUID();
};

/**
 * Creates a promise that resolves after the specified number of milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
};

/**
 * Type guard to check if a value is a Promise
 */
export const isPromise = <T>(value: T | Promise<T>): value is Promise<T> => {
  return value instanceof Promise;
};

/**
 * Simple and efficient deep clone implementation
 * 
 * @param value - The value to clone
 * @returns A deep clone of the value
 */
export const clone = <T>(value: T): T => {
  return deepCloneCustom(value);
};

/**
 * Custom deep clone implementation for environments without structuredClone
 */
function deepCloneCustom<T>(value: T, seen = new WeakMap()): T {
  // Handle primitives and null
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Handle circular references
  if (seen.has(value)) {
    return seen.get(value);
  }

  // Handle Date objects
  if (value instanceof Date) {
    const cloned = new Date(value.getTime()) as T;
    seen.set(value, cloned);
    return cloned;
  }

  // Handle RegExp objects
  if (value instanceof RegExp) {
    const cloned = new RegExp(value.source, value.flags) as T;
    seen.set(value, cloned);
    return cloned;
  }

  // Handle Arrays
  if (Array.isArray(value)) {
    const cloned = value.map(item => deepCloneCustom(item, seen)) as T;
    seen.set(value, cloned);
    return cloned;
  }

  // Handle Maps
  if (value instanceof Map) {
    const clonedMap = new Map();
    seen.set(value, clonedMap as T);
    for (const [key, val] of value.entries()) {
      clonedMap.set(deepCloneCustom(key, seen), deepCloneCustom(val, seen));
    }
    return clonedMap as T;
  }

  // Handle Sets
  if (value instanceof Set) {
    const clonedSet = new Set();
    seen.set(value, clonedSet as T);
    for (const val of value.values()) {
      clonedSet.add(deepCloneCustom(val, seen));
    }
    return clonedSet as T;
  }

  // Handle plain objects
  if (value.constructor === Object) {
    const clonedObj = {} as T;
    seen.set(value, clonedObj);
    for (const [key, val] of Object.entries(value)) {
      (clonedObj as any)[key] = deepCloneCustom(val, seen);
    }
    return clonedObj;
  }

  // For other object types, try to clone their properties
  try {
    const clonedObj = Object.create(Object.getPrototypeOf(value));
    seen.set(value, clonedObj as T);
    for (const [key, val] of Object.entries(value)) {
      (clonedObj as any)[key] = deepCloneCustom(val, seen);
    }
    return clonedObj as T;
  } catch {
    // If cloning fails, return the original value
    // This handles functions and other non-cloneable objects
    return value;
  }
}

import { Step, BaseContext } from './types';

/**
 * Essential utilities for the Fx framework
 */


// ---------- State Operations ----------

/**
 * Safely get a nested value from an object using dot notation
 */
export const getValueAtPath = (obj: unknown, path: string): unknown => {
  const keys = path.split('.');

  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

/**
 * Set a nested value in an object using dot notation
 */
export const setValueAtPath = (obj: unknown, path: string, value: unknown): unknown => {
  const keys = path.split('.');
  const result = clone(obj as Record<string, unknown>);

  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (key && (current[key] == null || typeof current[key] !== 'object')) {
      current[key] = {};
    }
    if (key) {
      current = current[key] as Record<string, unknown>;
    }
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
  return result;
};
