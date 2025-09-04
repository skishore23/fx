import crypto from "crypto";
import { Event } from './types';

/**
 * Optional and simple event logging for the Fx framework
 * No complex ledger management, just basic event tracking
 */

// Events storage (optional)
let events: Event[] = [];
let eventLogger: ((event: Event) => void) | null = null;

/**
 * Enable event logging
 */
export const enableLogging = (): void => {
  eventLogger = (event: Event) => {
    events.push(event);
    if (events.length > 1000) {
      // Keep only last 1000 events
      events = events.slice(-1000);
    }
  };
};

/**
 * Disable event logging
 */
export const disableLogging = (): void => {
  eventLogger = null;
  events = [];
};

/**
 * Log an event (if logging is enabled)
 */
export const logEvent = (name: string, data?: unknown): void => {
  if (!eventLogger) return;

  const event: Event = {
    id: crypto.randomUUID(),
    name,
    timestamp: new Date(),
    data
  };

  eventLogger(event);
};

/**
 * Get recent events
 */
export const getEvents = (limit = 100): Event[] => {
  return events.slice(-limit);
};

/**
 * Get events by name
 */
export const getEventsByName = (name: string): Event[] => {
  return events.filter(event => event.name === name);
};

/**
 * Clear all events
 */
export const clearEvents = (): void => {
  events = [];
};

/**
 * Get event statistics
 */
export const getEventStats = () => {
  const stats: Record<string, number> = {};
  for (const event of events) {
    stats[event.name] = (stats[event.name] || 0) + 1;
  }
  return stats;
};