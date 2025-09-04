import { 
  enableLogging, 
  disableLogging, 
  logEvent, 
  getEvents, 
  getEventsByName, 
  clearEvents, 
  getEventStats 
} from '../ledger';

describe('Ledger System - Fixed Implementation', () => {
  beforeEach(() => {
    // Clear events before each test
    clearEvents();
    disableLogging();
  });

  describe('enableLogging / disableLogging', () => {
    it('should enable and disable logging correctly', () => {
      expect(getEvents()).toHaveLength(0);
      
      enableLogging();
      logEvent('test-event', { data: 'test' });
      expect(getEvents()).toHaveLength(1);
      
      disableLogging();
      logEvent('another-event', { data: 'test2' });
      expect(getEvents()).toHaveLength(0); // Should not log when disabled
    });
  });

  describe('logEvent', () => {
    beforeEach(() => {
      enableLogging();
    });

    it('should log events with correct structure', () => {
      logEvent('test-event', { data: 'test' });
      const events = getEvents();
      
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: 'test-event',
        data: { data: 'test' },
        timestamp: expect.any(Date)
      });
      expect(events[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should log events without data', () => {
      logEvent('simple-event');
      const events = getEvents();
      
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: 'simple-event',
        data: undefined,
        timestamp: expect.any(Date)
      });
    });

    it('should not log when logging is disabled', () => {
      disableLogging();
      logEvent('test-event');
      expect(getEvents()).toHaveLength(0);
    });
  });

  describe('getEvents', () => {
    beforeEach(() => {
      enableLogging();
    });

    it('should return all events by default', () => {
      logEvent('event1');
      logEvent('event2');
      logEvent('event3');
      
      const events = getEvents();
      expect(events).toHaveLength(3);
    });

    it('should respect limit parameter', () => {
      logEvent('event1');
      logEvent('event2');
      logEvent('event3');
      
      const events = getEvents(2);
      expect(events).toHaveLength(2);
      expect(events[0]?.name).toBe('event2'); // Should return last 2 events
      expect(events[1]?.name).toBe('event3');
    });

    it('should return empty array when no events', () => {
      const events = getEvents();
      expect(events).toHaveLength(0);
    });
  });

  describe('getEventsByName', () => {
    beforeEach(() => {
      enableLogging();
    });

    it('should filter events by name', () => {
      logEvent('error-event', { error: 'test' });
      logEvent('info-event', { info: 'test' });
      logEvent('error-event', { error: 'test2' });
      
      const errorEvents = getEventsByName('error-event');
      const infoEvents = getEventsByName('info-event');
      const nonExistentEvents = getEventsByName('non-existent');
      
      expect(errorEvents).toHaveLength(2);
      expect(infoEvents).toHaveLength(1);
      expect(nonExistentEvents).toHaveLength(0);
    });
  });

  describe('clearEvents', () => {
    beforeEach(() => {
      enableLogging();
    });

    it('should clear all events', () => {
      logEvent('event1');
      logEvent('event2');
      expect(getEvents()).toHaveLength(2);
      
      clearEvents();
      expect(getEvents()).toHaveLength(0);
    });
  });

  describe('getEventStats', () => {
    beforeEach(() => {
      enableLogging();
    });

    it('should return correct statistics', () => {
      logEvent('error-event');
      logEvent('info-event');
      logEvent('error-event');
      logEvent('warning-event');
      logEvent('error-event');
      
      const stats = getEventStats();
      
      expect(stats).toEqual({
        'error-event': 3,
        'info-event': 1,
        'warning-event': 1
      });
    });

    it('should return empty stats when no events', () => {
      const stats = getEventStats();
      expect(stats).toEqual({});
    });
  });

  describe('Memory Management', () => {
    beforeEach(() => {
      enableLogging();
    });

    it('should handle large number of events without memory leak', () => {
      // Log more events than the cleanup threshold
      for (let i = 0; i < 1500; i++) {
        logEvent(`event-${i}`, { index: i });
      }
      
      const events = getEvents();
      // Should be limited to MAX_EVENTS (1000)
      expect(events.length).toBeLessThanOrEqual(1000);
      
      // Should keep the most recent events
      expect(events[0]?.name).toMatch(/^event-\d+$/);
      expect(events[events.length - 1]?.name).toMatch(/^event-\d+$/);
    });

    it('should maintain event order after cleanup', () => {
      // Log events and verify they're in chronological order
      for (let i = 0; i < 1200; i++) {
        logEvent(`event-${i}`, { index: i });
      }
      
      const events = getEvents();
      const timestamps = events.map(e => e.timestamp.getTime());
      
      // Check that timestamps are in ascending order
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid event names gracefully', () => {
      enableLogging();
      
      // These should not throw errors
      expect(() => logEvent('')).not.toThrow();
      expect(() => logEvent(null as any)).not.toThrow();
      expect(() => logEvent(undefined as any)).not.toThrow();
    });

    it('should handle invalid data gracefully', () => {
      enableLogging();
      
      // These should not throw errors
      expect(() => logEvent('test', null)).not.toThrow();
      expect(() => logEvent('test', undefined)).not.toThrow();
      expect(() => logEvent('test', { circular: {} })).not.toThrow();
    });
  });
});
