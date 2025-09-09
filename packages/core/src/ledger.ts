import crypto from "crypto";
import { Event, StateEvent, StateCheckpoint, BaseContext, Step } from './types';

/**
 * Functional ledger system - simple, immutable, step-based
 * Leverages the step abstraction for clean functional logging
 */

// Immutable state for ledger
interface LedgerState {
  readonly events: Event[];
  readonly stateEvents: StateEvent[];
  readonly checkpoints: StateCheckpoint[];
  readonly previousState: BaseContext | null;
  readonly isEnabled: boolean;
  readonly isStateLoggingEnabled: boolean;
  readonly [key: string]: unknown;
}

// Initial ledger state
const initialLedgerState: LedgerState = {
  events: [],
  stateEvents: [],
  checkpoints: [],
  previousState: null,
  isEnabled: false,
  isStateLoggingEnabled: false
};

// Global ledger state (immutable updates)
let ledgerState: LedgerState = initialLedgerState;

// Configuration
const MAX_EVENTS = 1000;
const MAX_STATE_EVENTS = 500;

// ===== PURE FUNCTIONS =====

/**
 * Create a new event
 */
const createEvent = (name: string, data?: unknown): Event => ({
  id: crypto.randomUUID(),
  name,
  timestamp: new Date(),
  data
});

/**
 * Create a state event with rich context
 */
const createStateEvent = <T extends BaseContext>(
  name: string,
  state: T,
  stepName?: string,
  runtime?: 'core' | 'navigator' | 'flow',
  metadata?: Record<string, unknown>
): StateEvent<T> => {
  const stateDiff = calculateStateDiff(state);
  const richContext = extractRichContext(state, stepName);
  
  return {
    id: crypto.randomUUID(),
    name,
    timestamp: new Date(),
    stepName,
    runtime,
    state: deepClone(state),
    stateDiff,
    metadata: {
      ...metadata,
      ...richContext
    }
  };
};

/**
 * Create a checkpoint
 */
const createCheckpointEvent = <T extends BaseContext>(
  stepName: string,
  state: T,
  runtime: 'core' | 'navigator' | 'flow'
): StateCheckpoint<T> => ({
  id: crypto.randomUUID(),
  timestamp: new Date(),
  stepName,
  runtime,
  state: deepClone(state),
  eventId: crypto.randomUUID()
});

/**
 * Calculate state diff between previous and current state
 */
const calculateStateDiff = <T extends BaseContext>(currentState: T): Partial<T> | undefined => {
  if (!ledgerState.previousState) return undefined;

  const diff: Partial<T> = {};
  let hasChanges = false;

  // Check for changes in current state
  for (const key in currentState) {
    if (currentState.hasOwnProperty(key)) {
      const currentValue = currentState[key];
      const previousValue = ledgerState.previousState[key];
      
      if (!deepEqual(currentValue, previousValue)) {
        diff[key] = currentValue;
        hasChanges = true;
      }
    }
  }

  // Check for removed properties
  for (const key in ledgerState.previousState) {
    if (ledgerState.previousState.hasOwnProperty(key) && !(key in currentState)) {
      (diff as any)[key] = undefined;
      hasChanges = true;
    }
  }

  return hasChanges ? diff : undefined;
};

/**
 * Extract rich context from state
 */
const extractRichContext = <T extends BaseContext>(state: T, stepName?: string): Record<string, unknown> => {
  const context: Record<string, unknown> = {};

  // Extract conversation context
  if ('conversation' in state && Array.isArray(state.conversation)) {
    context.conversation = {
      messageCount: state.conversation.length,
      lastMessage: state.conversation[state.conversation.length - 1],
      roles: state.conversation.map(msg => msg.role)
    };
  }

  // Extract LLM context
  if ('systemResponse' in state) {
    context.llm = {
      response: state.systemResponse,
      usage: state.systemUsage,
      metadata: state.systemMetadata,
      model: (state.systemMetadata as any)?.model,
      tokens: (state.systemUsage as any)?.totalTokens
    };
  }

  // Extract tool execution context
  if ('lastTool' in state) {
    context.toolExecution = {
      lastTool: state.lastTool,
      toolsToUse: state.toolsToUse,
      error: state.error
    };
  }

  // Extract memory context
  if ('memory' in state && Array.isArray(state.memory)) {
    context.memory = {
      entryCount: state.memory.length,
      recentEntries: state.memory.slice(-3),
      types: [...new Set(state.memory.map(entry => entry.type))]
    };
  }

  // Extract goal context
  if ('currentGoal' in state) {
    context.goal = {
      current: state.currentGoal,
      analysisComplete: state.analysisComplete
    };
  }

  // Extract error context
  if ('error' in state && state.error) {
    context.error = {
      message: state.error,
      step: stepName,
      timestamp: new Date().toISOString()
    };
  }

  return context;
};

/**
 * Deep clone utility
 */
const deepClone = <T>(obj: T): T => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (Array.isArray(obj)) return obj.map(item => deepClone(item)) as T;
  
  const cloned = {} as T;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
};

/**
 * Deep equality check
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  
  if (keysA.length !== keysB.length) return false;
  
  return keysA.every(key => 
    keysB.includes(key) && 
    deepEqual((a as any)[key], (b as any)[key])
  );
};

/**
 * Cleanup events if needed
 */
const cleanupEvents = (events: Event[]): Event[] => {
  return events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events;
};

const cleanupStateEvents = (stateEvents: StateEvent[]): StateEvent[] => {
  return stateEvents.length > MAX_STATE_EVENTS ? stateEvents.slice(-MAX_STATE_EVENTS) : stateEvents;
};

// ===== IMMUTABLE STATE UPDATES =====

/**
 * Update ledger state immutably
 */
const updateLedgerState = (updater: (state: LedgerState) => LedgerState): void => {
  ledgerState = updater(ledgerState);
};

// ===== PUBLIC API =====

/**
 * Enable basic event logging
 */
export const enableLogging = (): void => {
  updateLedgerState(state => ({ ...state, isEnabled: true }));
};

/**
 * Enable state logging
 */
export const enableStateLogging = (): void => {
  updateLedgerState(state => ({ ...state, isStateLoggingEnabled: true }));
};

/**
 * Enable both basic and state logging
 */
export const enableFullLogging = (): void => {
  updateLedgerState(state => ({ 
    ...state, 
    isEnabled: true, 
    isStateLoggingEnabled: true 
  }));
};

/**
 * Disable all logging
 */
export const disableLogging = (): void => {
  updateLedgerState(state => ({
    ...state,
    isEnabled: false,
    isStateLoggingEnabled: false,
    events: [],
    stateEvents: [],
    checkpoints: [],
    previousState: null
  }));
};

/**
 * Log a basic event
 */
export const logEvent = (name: string, data?: unknown): void => {
  if (!ledgerState.isEnabled) return;
  
  const event = createEvent(name, data);
  updateLedgerState(state => ({
    ...state,
    events: cleanupEvents([...state.events, event])
  }));
};

/**
 * Log a state event
 */
export const logStateEvent = <T extends BaseContext>(
  name: string, 
  state: T, 
  stepName?: string, 
  runtime?: 'core' | 'navigator' | 'flow',
  metadata?: Record<string, unknown>
): void => {
  if (!ledgerState.isStateLoggingEnabled) return;
  
  const stateEvent = createStateEvent(name, state, stepName, runtime, metadata);
  updateLedgerState(ledgerState => ({
    ...ledgerState,
    stateEvents: cleanupStateEvents([...ledgerState.stateEvents, stateEvent]),
    previousState: deepClone(state)
  }));
};

/**
 * Create a checkpoint
 */
export const createCheckpoint = <T extends BaseContext>(
  stepName: string,
  state: T,
  runtime: 'core' | 'navigator' | 'flow'
): string => {
  const checkpoint = createCheckpointEvent(stepName, state, runtime);
  updateLedgerState(state => ({
    ...state,
    checkpoints: [...state.checkpoints, checkpoint]
  }));
  return checkpoint.id;
};

/**
 * Get state at checkpoint
 */
export const getStateAtCheckpoint = (checkpointId: string): BaseContext | null => {
  const checkpoint = ledgerState.checkpoints.find(cp => cp.id === checkpointId);
  return checkpoint ? checkpoint.state : null;
};

/**
 * Replay from checkpoint
 */
export const replayFromCheckpoint = <T extends BaseContext>(checkpointId: string): T | null => {
  const checkpoint = ledgerState.checkpoints.find(cp => cp.id === checkpointId);
  if (!checkpoint) return null;

  const checkpointTime = checkpoint.timestamp;
  const subsequentEvents = ledgerState.stateEvents.filter(event => 
    event.timestamp > checkpointTime
  );

  // Compose state transformations functionally
  const stateTransformations = subsequentEvents
    .filter(event => event.stateDiff)
    .map(event => (state: T) => ({ ...state, ...event.stateDiff } as T));

  // Apply transformations in sequence
  return stateTransformations.reduce(
    (state, transform) => transform(state),
    deepClone(checkpoint.state) as T
  );
};

/**
 * Get events
 */
export const getEvents = (limit = 100): Event[] => {
  return ledgerState.events.slice(-limit);
};

/**
 * Get state events
 */
export const getStateEvents = (limit = 100): StateEvent[] => {
  return ledgerState.stateEvents.slice(-limit);
};

/**
 * Get state events by step
 */
export const getStateEventsByStep = (stepName: string): StateEvent[] => {
  return ledgerState.stateEvents.filter(event => event.stepName === stepName);
};

/**
 * Get state events by runtime
 */
export const getStateEventsByRuntime = (runtime: 'core' | 'navigator' | 'flow'): StateEvent[] => {
  return ledgerState.stateEvents.filter(event => event.runtime === runtime);
};

/**
 * Get checkpoints
 */
export const getCheckpoints = (): StateCheckpoint[] => {
  return [...ledgerState.checkpoints];
};

/**
 * Get events by name
 */
export const getEventsByName = (name: string): Event[] => {
  return ledgerState.events.filter(event => event.name === name);
};

/**
 * Clear all events
 */
export const clearEvents = (): void => {
  updateLedgerState(() => initialLedgerState);
};

/**
 * Get event stats
 */
export const getEventStats = (): Record<string, number> => {
  const stats: Record<string, number> = {};
  for (const event of ledgerState.events) {
    stats[event.name] = (stats[event.name] || 0) + 1;
  }
  return stats;
};

/**
 * Get state event stats
 */
export const getStateEventStats = (): Record<string, number> => {
  const stats: Record<string, number> = {};
  for (const event of ledgerState.stateEvents) {
    const key = event.stepName ? `${event.name}:${event.stepName}` : event.name;
    stats[key] = (stats[key] || 0) + 1;
  }
  return stats;
};

// ===== STEP-BASED LOGGING =====

/**
 * Create a step that logs events
 */
export const logStep = <T extends BaseContext>(
  name: string, 
  data?: unknown
): Step<T> => {
  return async (state: T) => {
    logEvent(name, data);
    return state;
  };
};

/**
 * Create a step that logs state events
 */
export const logStateStep = <T extends BaseContext>(
  name: string,
  stepName?: string,
  runtime?: 'core' | 'navigator' | 'flow',
  metadata?: Record<string, unknown>
): Step<T> => {
  return async (state: T) => {
    logStateEvent(name, state, stepName, runtime, metadata);
    return state;
  };
};

/**
 * Create a step that creates checkpoints
 */
export const checkpointStep = <T extends BaseContext>(
  stepName: string,
  runtime: 'core' | 'navigator' | 'flow'
): Step<T> => {
  return async (state: T) => {
    createCheckpoint(stepName, state, runtime);
    return state;
  };
};

/**
 * Compose state recreation from events using functional composition
 */
export const recreateStateFromEvents = <T extends BaseContext>(
  events: StateEvent[],
  initialState: T
): T => {
  const stateTransformations = events
    .filter(event => event.stateDiff)
    .map(event => (state: T) => ({ ...state, ...event.stateDiff } as T));

  return stateTransformations.reduce(
    (state, transform) => transform(state),
    deepClone(initialState)
  );
};

/**
 * Get state at any point in time using functional composition
 */
export const getStateAtTime = <T extends BaseContext>(
  timestamp: Date,
  initialState: T
): T => {
  const eventsUpToTime = ledgerState.stateEvents.filter(event => 
    event.timestamp <= timestamp
  );
  
  return recreateStateFromEvents(eventsUpToTime, initialState);
};

// Export types
export type { StateEvent, StateCheckpoint } from './types';