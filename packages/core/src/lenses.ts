/**
 * State operations as morphisms in the category of state transformations
 * Simplified implementation with clean types
 */

import { BaseContext } from './types';
import { getValueAtPath, setValueAtPath } from './utils';

// ---------- Memory Types ----------

export interface MemoryEntry {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
}

// ---------- Unified State Operations ----------

/**
 * Pure state update function - the essence of fx-core
 * Context is state, state changes are transformations
 * This is the fundamental morphism in our state category
 * 
 * @param updates - Partial state updates to apply
 * @returns A pure function that transforms state
 */
export const updateState = <T extends BaseContext>(updates: Partial<T>) => {
  return (state: T): T => {
    return { ...state, ...updates } as T;
  };
};

/**
 * Add memory entry - morphism in the state category
 * This is a pure function that transforms state by adding a memory entry
 * 
 * @param type - Type of memory entry (e.g., 'action', 'observation', 'error')
 * @param content - Content of the memory entry
 * @param metadata - Optional metadata for the memory entry
 * @returns A pure function that adds a memory entry to state
 */
export const addState = <T extends BaseContext>(
  type: string, 
  content: string, 
  metadata?: Record<string, unknown>
) => {
  return (state: T): T => {
    const memory = (state.memory as MemoryEntry[]) || [];
    const newEntry: MemoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      timestamp: new Date(),
      metadata
    };
    
    return { ...state, memory: [...memory, newEntry] } as T;
  };
};

/**
 * Add a complete memory entry - morphism in the state category
 * 
 * @param entry - Complete memory entry to add
 * @returns A pure function that adds a memory entry to state
 */
export const addMemoryEntry = <T extends BaseContext>(entry: MemoryEntry) => {
  return (state: T): T => {
    const memory = (state.memory as MemoryEntry[]) || [];
    return { ...state, memory: [...memory, entry] } as T;
  };
};









/**
 * Sets a value at the specified path - morphism in state category
 * Simplified to return the transformed state directly
 */
export const set = <T extends BaseContext>(path: string, value: unknown) => {
  return (state: T) => {
    return setValueAtPath(state, path, value) as T;
  };
};

/**
 * Gets a value at the specified path - morphism from State to unknown
 */
export const get = <T extends BaseContext>(path: string) => {
  return (state: T) => {
    return getValueAtPath(state, path);
  };
};

/**
 * Updates a value at the specified path using an updater function
 */
export const update = <T extends BaseContext>(path: string, updater: (value: unknown) => unknown) => {
  return (state: T) => {
    const currentValue = getValueAtPath(state, path);
    const newValue = updater(currentValue);
    return setValueAtPath(state, path, newValue) as T;
  };
};

/**
 * Pushes an item to an array at the specified path
 */
export const push = <T extends BaseContext>(path: string, item: unknown) => {
  return (state: T) => {
    const currentArray = getValueAtPath(state, path) || [];
    if (!Array.isArray(currentArray)) {
      throw new Error(`Cannot push to non-array at path: ${path}`);
    }
    const newArray = [...currentArray, item];
    return setValueAtPath(state, path, newArray) as T;
  };
};

/**
 * Removes items from an array at the specified path
 */
export const remove = <T extends BaseContext>(
  path: string,
  predicate: ((item: unknown, index: number) => boolean) | number
) => {
  return (state: T) => {
    const currentArray = getValueAtPath(state, path) || [];
    if (!Array.isArray(currentArray)) {
      throw new Error(`Cannot remove from non-array at path: ${path}`);
    }

    let newArray: unknown[];
    if (typeof predicate === 'number') {
      // Remove by index
      newArray = [...currentArray.slice(0, predicate), ...currentArray.slice(predicate + 1)];
    } else {
      // Remove by predicate function
      newArray = currentArray.filter((item, index) => !predicate(item, index));
    }

    return setValueAtPath(state, path, newArray) as T;
  };
};