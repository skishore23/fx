/**
 * Memory System for Fx Framework
 * Simplified implementation with clean types
 */

import { Step, BaseContext } from './types';

// ---------- Memory Types ----------

export interface MemoryEntry {
  readonly id: string;
  readonly type: 'observation' | 'action' | 'result' | 'error';
  readonly content: string;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface MemoryFilter {
  type?: MemoryEntry['type'];
  since?: Date;
  limit?: number;
  search?: string;
}

// ---------- Memory Operations ----------

/**
 * Add memory entry - simple state transformation
 * Simplified to return the transformed state directly
 */
export const addMemory = <T extends BaseContext>(
  type: MemoryEntry['type'],
  content: string,
  metadata?: Record<string, unknown>
) => {
  return (state: T) => {
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
 * Get memory entries with optional filtering
 */
export const getMemory = <T extends BaseContext>(filter?: MemoryFilter): Step<T> => {
  return async (state: T) => {
    const memory = (state.memory as MemoryEntry[]) || [];
    let filtered = memory;

    if (filter) {
      if (filter.type) {
        filtered = filtered.filter(entry => entry.type === filter.type);
      }
      if (filter.since) {
        filtered = filtered.filter(entry => entry.timestamp >= filter.since!);
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        filtered = filtered.filter(entry => 
          entry.content.toLowerCase().includes(searchLower)
        );
      }
      if (filter.limit) {
        filtered = filtered.slice(-filter.limit);
      }
    }

    return { ...state, memoryFiltered: filtered } as T;
  };
};

/**
 * Clear memory
 */
export const clearMemory = <T extends BaseContext>(): Step<T> => {
  return async (state: T) => {
    return { ...state, memory: [] } as T;
  };
};

/**
 * Search memory
 */
export const searchMemory = <T extends BaseContext>(query: string): Step<T> => {
  return async (state: T) => {
    const memory = (state.memory as MemoryEntry[]) || [];
    const searchLower = query.toLowerCase();
    const results = memory.filter(entry => 
      entry.content.toLowerCase().includes(searchLower)
    );

    return { 
      ...state, 
      memorySearchQuery: query,
      memorySearchResults: results 
    } as T;
  };
};

/**
 * Get memory count
 */
export const getMemoryCount = <T extends BaseContext>(): Step<T> => {
  return async (state: T) => {
    const memory = (state.memory as MemoryEntry[]) || [];
    return { ...state, memoryCount: memory.length } as T;
  };
};

// ---------- Memory Lenses ----------

/**
 * Create a lens for memory access
 */
export const memoryLens = <T extends BaseContext>(): {
  get: (state: T) => MemoryEntry[];
  set: (state: T, memory: MemoryEntry[]) => T;
  update: (state: T, updater: (memory: MemoryEntry[]) => MemoryEntry[]) => T;
} => {
  return {
    get: (state: T) => (state.memory as MemoryEntry[]) || [],
    set: (state: T, memory: MemoryEntry[]) => ({ ...state, memory }) as T,
    update: (state: T, updater: (memory: MemoryEntry[]) => MemoryEntry[]) => {
      const currentMemory = (state.memory as MemoryEntry[]) || [];
      const newMemory = updater(currentMemory);
      return { ...state, memory: newMemory } as T;
    }
  };
};

/**
 * Create a lens for filtered memory access
 */
export const filteredMemoryLens = <T extends BaseContext>(): {
  get: (state: T) => MemoryEntry[];
  set: (state: T, memory: MemoryEntry[]) => T;
} => {
  return {
    get: (state: T) => (state.memoryFiltered as MemoryEntry[]) || [],
    set: (state: T, memory: MemoryEntry[]) => ({ ...state, memoryFiltered: memory }) as T
  };
};

// ---------- Memory Helper Functions ----------

/**
 * Log an observation - what the agent sees or notices
 */
export const logObservation = <T extends BaseContext>(content: string, metadata?: Record<string, unknown>) => {
  return addMemory('observation', content, metadata);
};

/**
 * Log an action - what the agent does or executes
 */
export const logAction = <T extends BaseContext>(content: string, metadata?: Record<string, unknown>) => {
  return addMemory('action', content, metadata);
};

/**
 * Log an outcome - what happened as a result
 */
export const logOutcome = <T extends BaseContext>(content: string, metadata?: Record<string, unknown>) => {
  return addMemory('result', content, metadata);
};

/**
 * Log an error - what went wrong
 */
export const logError = <T extends BaseContext>(content: string, metadata?: Record<string, unknown>) => {
  return addMemory('error', content, metadata);
};

// Legacy aliases for backward compatibility
export const addObservation = logObservation;
export const addAction = logAction;
export const addResult = logOutcome;
export const addError = logError;

/**
 * Get recent memory entries (last N entries)
 */
export const getRecentMemory = <T extends BaseContext>(count: number = 10): Step<T> => {
  return getMemory({ limit: count });
};

/**
 * Get memory by type
 */
export const getMemoryByType = <T extends BaseContext>(type: MemoryEntry['type']): Step<T> => {
  return getMemory({ type });
};

/**
 * Get memory since a specific time
 */
export const getMemorySince = <T extends BaseContext>(since: Date): Step<T> => {
  return getMemory({ since });
};

/**
 * Search memory for specific content
 */
export const searchMemoryContent = <T extends BaseContext>(query: string): Step<T> => {
  return searchMemory(query);
};


