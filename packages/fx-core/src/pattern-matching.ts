/**
 * Pattern Matching System
 * Declarative pattern matching for state transformations
 */

import { BaseContext } from './types';

/**
 * Pattern definition
 */
export interface Pattern<T extends BaseContext, R> {
  match: (state: T) => boolean;
  action: (state: T) => R;
  priority?: number; // Higher numbers = higher priority
}

/**
 * Pattern matcher for state transformations
 */
export class PatternMatcher<T extends BaseContext, R> {
  private patterns: Pattern<T, R>[] = [];

  /**
   * Add a pattern
   */
  add(pattern: Pattern<T, R>): this {
    this.patterns.push(pattern);
    // Sort by priority (highest first)
    this.patterns.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return this;
  }

  /**
   * Add multiple patterns
   */
  addMany(patterns: Pattern<T, R>[]): this {
    patterns.forEach(pattern => this.add(pattern));
    return this;
  }

  /**
   * Match against state and return the first matching pattern's result
   */
  match(state: T): R | null {
    for (const pattern of this.patterns) {
      if (pattern.match(state)) {
        return pattern.action(state);
      }
    }
    return null;
  }

  /**
   * Match against state and return all matching patterns' results
   */
  matchAll(state: T): R[] {
    return this.patterns
      .filter(pattern => pattern.match(state))
      .map(pattern => pattern.action(state));
  }

  /**
   * Create a function that applies the first matching pattern
   */
  createMatcher(defaultAction?: (state: T) => R): (state: T) => R {
    return (state: T): R => {
      const result = this.match(state);
      if (result !== null) {
        return result;
      }
      if (defaultAction) {
        return defaultAction(state);
      }
      throw new Error('No pattern matched and no default action provided');
    };
  }
}

/**
 * Create a new pattern matcher
 */
export const createPatternMatcher = <T extends BaseContext, R>(): PatternMatcher<T, R> => {
  return new PatternMatcher<T, R>();
};

/**
 * Create a pattern
 */
export const createPattern = <T extends BaseContext, R>(
  match: (state: T) => boolean,
  action: (state: T) => R,
  priority?: number
): Pattern<T, R> => ({
  match,
  action,
  priority
});

/**
 * Common pattern helpers
 */
export const patterns = {
  /**
   * Match if a field contains a value
   */
  fieldContains: <T extends BaseContext>(
    field: keyof T,
    value: string
  ) => (state: T): boolean => {
    const fieldValue = state[field];
    return typeof fieldValue === 'string' && fieldValue.toLowerCase().includes(value.toLowerCase());
  },

  /**
   * Match if a field equals a value
   */
  fieldEquals: <T extends BaseContext>(
    field: keyof T,
    value: any
  ) => (state: T): boolean => {
    return state[field] === value;
  },

  /**
   * Match if multiple conditions are true
   */
  all: <T extends BaseContext>(
    ...conditions: Array<(state: T) => boolean>
  ) => (state: T): boolean => {
    return conditions.every(condition => condition(state));
  },

  /**
   * Match if any condition is true
   */
  any: <T extends BaseContext>(
    ...conditions: Array<(state: T) => boolean>
  ) => (state: T): boolean => {
    return conditions.some(condition => condition(state));
  },

  /**
   * Match if a field matches a regex
   */
  fieldMatches: <T extends BaseContext>(
    field: keyof T,
    regex: RegExp
  ) => (state: T): boolean => {
    const fieldValue = state[field];
    return typeof fieldValue === 'string' && regex.test(fieldValue);
  }
};
