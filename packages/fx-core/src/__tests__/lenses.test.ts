import { 
  updateState, 
  addState, 
  addMemoryEntry,
  set, 
  get, 
  update, 
  push, 
  remove,
  MemoryEntry
} from '../lenses';

interface TestState {
  value: number;
  message?: string;
  memory: MemoryEntry[];
  items: any[];
  [key: string]: any;
}

describe('Lenses - Fixed Implementation', () => {
  describe('updateState', () => {
    it('should update state with partial updates', () => {
      const state: TestState = { value: 5, message: 'hello', memory: [], items: [] };
      const updateFn = updateState({ value: 10, newField: 'test' } as Partial<TestState>);
      const result = updateFn(state);
      
      expect(result).toEqual({
        value: 10,
        message: 'hello',
        memory: [],
        items: [],
        newField: 'test'
      });
      expect(result).not.toBe(state); // Should not mutate original
    });

    it('should handle empty updates', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const updateFn = updateState({});
      const result = updateFn(state);
      
      expect(result).toEqual(state);
      expect(result).not.toBe(state); // Still creates new object
    });

    it('should preserve existing properties not in updates', () => {
      const state: TestState = { 
        value: 5, 
        message: 'hello', 
        memory: [], 
        items: [],
        existing: 'preserved'
      };
      const updateFn = updateState({ value: 10 });
      const result = updateFn(state);
      
      expect(result.message).toBe('hello');
      expect((result as any).existing).toBe('preserved');
    });
  });

  describe('addState', () => {
    it('should add memory entry with correct structure', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const addFn = addState('action', 'User logged in', { userId: 123 });
      const result = addFn(state);
      
      expect((result.memory as any[])).toHaveLength(1);
      expect((result.memory as any[])[0]).toMatchObject({
        type: 'action',
        content: 'User logged in',
        metadata: { userId: 123 },
        timestamp: expect.any(Date)
      });
      expect((result.memory as any[])[0].id).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('should add multiple memory entries', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      
      let result = addState('action', 'First action')(state);
      result = addState('observation', 'First observation')(result);
      result = addState('error', 'First error')(result);
      
      expect((result.memory as any[])).toHaveLength(3);
      expect((result.memory as any[])[0].type).toBe('action');
      expect((result.memory as any[])[1].type).toBe('observation');
      expect((result.memory as any[])[2].type).toBe('error');
    });

    it('should handle empty memory array', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const addFn = addState('action', 'Test action');
      const result = addFn(state);
      
      expect((result.memory as any[])).toHaveLength(1);
      expect((result.memory as any[])[0].content).toBe('Test action');
    });

    it('should not mutate original state', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const addFn = addState('action', 'Test action');
      const result = addFn(state);
      
      expect((state.memory as any[])).toHaveLength(0);
      expect((result.memory as any[])).toHaveLength(1);
    });
  });

  describe('addMemoryEntry', () => {
    it('should add complete memory entry', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const entry: MemoryEntry = {
        id: 'test-id',
        type: 'action',
        content: 'Test action',
        timestamp: new Date('2023-01-01'),
        metadata: { test: true }
      };
      
      const addFn = addMemoryEntry(entry);
      const result = addFn(state);
      
      expect((result.memory as any[])).toHaveLength(1);
      expect((result.memory as any[])[0]).toEqual(entry);
    });

    it('should add to existing memory', () => {
      const existingEntry: MemoryEntry = {
        id: 'existing-id',
        type: 'action',
        content: 'Existing action',
        timestamp: new Date('2023-01-01')
      };
      
      const state: TestState = { value: 5, memory: [existingEntry], items: [] };
      const newEntry: MemoryEntry = {
        id: 'new-id',
        type: 'observation',
        content: 'New observation',
        timestamp: new Date('2023-01-02')
      };
      
      const addFn = addMemoryEntry(newEntry);
      const result = addFn(state);
      
      expect((result.memory as any[])).toHaveLength(2);
      expect((result.memory as any[])[0]).toEqual(existingEntry);
      expect((result.memory as any[])[1]).toEqual(newEntry);
    });
  });

  describe('set', () => {
    it('should set values at simple paths', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const setFn = set('message', 'hello');
      const result = setFn(state);
      
      expect(result.message).toBe('hello');
      expect(result.value).toBe(5); // Other properties preserved
    });

    it('should set values at nested paths', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const setFn = set('user.profile.name', 'John');
      const result = setFn(state);
      
      expect(result).toEqual({
        value: 5,
        memory: [],
        items: [],
        user: {
          profile: {
            name: 'John'
          }
        }
      });
    });

    it('should not mutate original state', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const setFn = set('message', 'hello');
      const result = setFn(state);
      
      expect(state.message).toBeUndefined();
      expect(result.message).toBe('hello');
    });
  });

  describe('get', () => {
    it('should get values at simple paths', () => {
      const state: TestState = { value: 5, message: 'hello', memory: [], items: [] };
      const getFn = get('message');
      const result = getFn(state);
      
      expect(result).toBe('hello');
    });

    it('should get values at nested paths', () => {
      const state: TestState = { 
        value: 5, 
        memory: [], 
        items: [],
        user: { profile: { name: 'John' } }
      };
      const getFn = get('user.profile.name');
      const result = getFn(state);
      
      expect(result).toBe('John');
    });

    it('should return undefined for non-existent paths', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const getFn = get('non.existent.path');
      const result = getFn(state);
      
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update values using updater function', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const updateFn = update('value', (val: unknown) => (val as number) * 2);
      const result = updateFn(state);
      
      expect(result.value).toBe(10);
    });

    it('should update nested values', () => {
      const state: TestState = { 
        value: 5, 
        memory: [], 
        items: [],
        user: { profile: { count: 5 } }
      };
      const updateFn = update('user.profile.count', (val: unknown) => (val as number) + 1);
      const result = updateFn(state);
      
      expect((result as any).user.profile.count).toBe(6);
    });

    it('should handle non-existent paths', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const updateFn = update('non.existent', (val: any) => val || 'default');
      const result = updateFn(state);
      
      expect(result).toEqual({
        value: 5,
        memory: [],
        items: [],
        non: { existent: 'default' }
      });
    });
  });

  describe('push', () => {
    it('should push items to arrays', () => {
      const state: TestState = { value: 5, memory: [], items: [1, 2] };
      const pushFn = push('items', 3);
      const result = pushFn(state);
      
      expect(result.items).toEqual([1, 2, 3]);
    });

    it('should create array if it does not exist', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const pushFn = push('newArray', 'first');
      const result = pushFn(state);
      
      expect(result.newArray).toEqual(['first']);
    });

    it('should throw error for non-array paths', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const pushFn = push('value', 3); // value is a number, not array
      
      expect(() => pushFn(state)).toThrow('Cannot push to non-array at path: value');
    });

    it('should not mutate original array', () => {
      const state: TestState = { value: 5, memory: [], items: [1, 2] };
      const pushFn = push('items', 3);
      const result = pushFn(state);
      
      expect(state.items).toEqual([1, 2]);
      expect(result.items).toEqual([1, 2, 3]);
    });
  });

  describe('remove', () => {
    it('should remove items by index', () => {
      const state: TestState = { value: 5, memory: [], items: [1, 2, 3, 4] };
      const removeFn = remove('items', 1); // Remove index 1
      const result = removeFn(state);
      
      expect(result.items).toEqual([1, 3, 4]);
    });

    it('should remove items by predicate', () => {
      const state: TestState = { value: 5, memory: [], items: [1, 2, 3, 4, 5] };
      const removeFn = remove('items', (item: unknown) => (item as number) % 2 === 0); // Remove even numbers
      const result = removeFn(state);
      
      expect(result.items).toEqual([1, 3, 5]);
    });

    it('should throw error for non-array paths', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const removeFn = remove('value', 0); // value is a number, not array
      
      expect(() => removeFn(state)).toThrow('Cannot remove from non-array at path: value');
    });

    it('should handle empty arrays', () => {
      const state: TestState = { value: 5, memory: [], items: [] };
      const removeFn = remove('items', 0);
      const result = removeFn(state);
      
      expect(result.items).toEqual([]);
    });

    it('should not mutate original array', () => {
      const state: TestState = { value: 5, memory: [], items: [1, 2, 3] };
      const removeFn = remove('items', 1);
      const result = removeFn(state);
      
      expect(state.items).toEqual([1, 2, 3]);
      expect(result.items).toEqual([1, 3]);
    });
  });

  describe('Type Safety', () => {
    it('should work with different state types', () => {
      interface CustomState {
        data: string;
        memory: MemoryEntry[];
        [key: string]: any;
      }

      const state: CustomState = { data: 'test', memory: [] };
      const updateFn = updateState<CustomState>({ data: 'updated' });
      const result = updateFn(state);
      
      expect(result.data).toBe('updated');
    });
  });
});
