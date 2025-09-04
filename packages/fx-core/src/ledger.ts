import crypto from "crypto";
import { Event } from './types';

/**
 * Optional and simple event logging for the Fx framework
 * No complex ledger management, just basic event tracking
 */

// Configuration constants
const MAX_EVENTS = 1000;
const CLEANUP_THRESHOLD = 1200; // Start cleanup when we exceed this

// Events storage (optional) - using class-based approach for better memory management
class EventLedger {
  private events: Event[] = [];
  private eventLogger: ((event: Event) => void) | null = null;
  private isEnabled = false;

  enable(): void {
    this.isEnabled = true;
    this.eventLogger = (event: Event) => {
      this.events.push(event);
      this.cleanupIfNeeded();
    };
  }

  disable(): void {
    this.isEnabled = false;
    this.eventLogger = null;
    this.events = [];
  }

  log(name: string, data?: unknown): void {
    if (!this.eventLogger) return;

    const event: Event = {
      id: crypto.randomUUID(),
      name,
      timestamp: new Date(),
      data
    };

    this.eventLogger(event);
  }

  getEvents(limit = 100): Event[] {
    return this.events.slice(-limit);
  }

  getEventsByName(name: string): Event[] {
    return this.events.filter(event => event.name === name);
  }

  clear(): void {
    this.events = [];
  }

  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const event of this.events) {
      stats[event.name] = (stats[event.name] || 0) + 1;
    }
    return stats;
  }

  private cleanupIfNeeded(): void {
    if (this.events.length > CLEANUP_THRESHOLD) {
      // Keep only the most recent events
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }
}

// Singleton instance
const eventLedger = new EventLedger();

/**
 * Enable event logging
 */
export const enableLogging = (): void => {
  eventLedger.enable();
};

/**
 * Disable event logging
 */
export const disableLogging = (): void => {
  eventLedger.disable();
};

/**
 * Log an event (if logging is enabled)
 */
export const logEvent = (name: string, data?: unknown): void => {
  eventLedger.log(name, data);
};

/**
 * Get recent events
 */
export const getEvents = (limit = 100): Event[] => {
  return eventLedger.getEvents(limit);
};

/**
 * Get events by name
 */
export const getEventsByName = (name: string): Event[] => {
  return eventLedger.getEventsByName(name);
};

/**
 * Clear all events
 */
export const clearEvents = (): void => {
  eventLedger.clear();
};

/**
 * Get event statistics
 */
export const getEventStats = (): Record<string, number> => {
  return eventLedger.getStats();
};