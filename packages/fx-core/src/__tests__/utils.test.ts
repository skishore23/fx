import { 
  clone, 
  newId, 
  sleep, 
  isPromise, 
  getValueAtPath, 
  setValueAtPath
} from '../utils';
import { identity, compose, composeAll } from '../composition';

describe('Utils - Fixed Implementation', () => {
  describe('clone', () => {
    it('should clone primitives correctly', () => {
      expect(clone(42)).toBe(42);
      expect(clone('hello')).toBe('hello');
      expect(clone(true)).toBe(true);
      expect(clone(null)).toBe(null);
      expect(clone(undefined)).toBe(undefined);
    });

    it('should clone Date objects correctly', () => {
      const date = new Date('2023-01-01T00:00:00Z');
      const cloned = clone(date);
      
      expect(cloned).toBeInstanceOf(Date);
      expect(cloned.getTime()).toBe(date.getTime());
      expect(cloned).not.toBe(date); // Different object reference
    });

    it('should clone RegExp objects correctly', () => {
      const regex = /test/gi;
      const cloned = clone(regex);
      
      expect(cloned).toBeInstanceOf(RegExp);
      expect(cloned.source).toBe(regex.source);
      expect(cloned.flags).toBe(regex.flags);
      expect(cloned).not.toBe(regex); // Different object reference
    });

    it('should clone arrays correctly', () => {
      const arr = [1, 'hello', { nested: true }, [2, 3]];
      const cloned = clone(arr);
      
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr); // Different array reference
      expect(cloned[2]).not.toBe(arr[2]); // Nested objects are different
      expect(cloned[3]).not.toBe(arr[3]); // Nested arrays are different
    });

    it('should clone Maps correctly', () => {
      const map = new Map([
        ['key1', 'value1'],
        ['key2', 'value2']
      ]);
      const cloned = clone(map);
      
      expect(cloned).toBeInstanceOf(Map);
      expect(cloned.size).toBe(map.size);
      expect(cloned.get('key1')).toBe('value1');
      expect(cloned.get('key2')).toBe('value2');
    });

    it('should clone Sets correctly', () => {
      const set = new Set([1, 'hello', { nested: true }]);
      const cloned = clone(set);
      
      expect(cloned).toBeInstanceOf(Set);
      expect(cloned.size).toBe(set.size);
      expect(cloned.has(1)).toBe(true);
      expect(cloned.has('hello')).toBe(true);
      expect(cloned.has({ nested: true })).toBe(false); // Object comparison fails
    });

    it('should clone plain objects correctly', () => {
      const obj = {
        string: 'hello',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { deep: true }
      };
      const cloned = clone(obj);
      
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj); // Different object reference
      expect(cloned.nested).not.toBe(obj.nested); // Nested objects are different
      expect(cloned.array).not.toBe(obj.array); // Nested arrays are different
    });

    it('should handle circular references gracefully', () => {
      const obj: any = { name: 'test' };
      obj.self = obj; // Create circular reference
      
      // Should not throw error
      expect(() => clone(obj)).not.toThrow();
      
      const cloned = clone(obj);
      expect(cloned.name).toBe('test');
      // Circular reference should be handled (return cloned reference)
      expect(cloned.self).toBe(cloned);
    });

    it('should handle functions gracefully', () => {
      const obj = {
        func: () => 'hello',
        normal: 'world'
      };
      
      const cloned = clone(obj);
      expect(cloned.normal).toBe('world');
      expect(cloned.func).toBe(obj.func); // Functions are returned as-is
    });

    it('should handle complex nested structures', () => {
      const complex = {
        date: new Date('2023-01-01'),
        regex: /test/gi,
        map: new Map([['key', 'value']]),
        set: new Set([1, 2, 3]),
        array: [
          { nested: true },
          [1, 2, { deep: true }]
        ],
        nested: {
          deeper: {
            deepest: 'value'
          }
        }
      };
      
      const cloned = clone(complex);
      expect(cloned).toEqual(complex);
      expect(cloned).not.toBe(complex);
      expect(cloned.date).not.toBe(complex.date);
      expect(cloned.regex).not.toBe(complex.regex);
      expect(cloned.map).not.toBe(complex.map);
      expect(cloned.set).not.toBe(complex.set);
    });
  });

  describe('newId', () => {
    it('should generate unique IDs', () => {
      const id1 = newId();
      const id2 = newId();
      
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const end = Date.now();
      
      expect(end - start).toBeGreaterThanOrEqual(45); // Allow some tolerance
    });
  });

  describe('isPromise', () => {
    it('should identify promises correctly', () => {
      expect(isPromise(Promise.resolve(42))).toBe(true);
      expect(isPromise(new Promise(() => {}))).toBe(true);
      expect(isPromise(42)).toBe(false);
      expect(isPromise('hello')).toBe(false);
      expect(isPromise({})).toBe(false);
      expect(isPromise(null)).toBe(false);
    });
  });

  describe('getValueAtPath', () => {
    it('should get values at simple paths', () => {
      const obj = { name: 'test', value: 42 };
      expect(getValueAtPath(obj, 'name')).toBe('test');
      expect(getValueAtPath(obj, 'value')).toBe(42);
    });

    it('should get values at nested paths', () => {
      const obj = { user: { profile: { name: 'John' } } };
      expect(getValueAtPath(obj, 'user.profile.name')).toBe('John');
    });

    it('should return undefined for non-existent paths', () => {
      const obj = { name: 'test' };
      expect(getValueAtPath(obj, 'non.existent.path')).toBeUndefined();
      expect(getValueAtPath(obj, 'name.nested')).toBeUndefined();
    });

    it('should handle null and undefined values', () => {
      expect(getValueAtPath(null, 'path')).toBeUndefined();
      expect(getValueAtPath(undefined, 'path')).toBeUndefined();
    });
  });

  describe('setValueAtPath', () => {
    it('should set values at simple paths', () => {
      const obj = { name: 'test' };
      const result = setValueAtPath(obj, 'value', 42);
      
      expect(result).toEqual({ name: 'test', value: 42 });
      expect(result).not.toBe(obj); // Should not mutate original
    });

    it('should set values at nested paths', () => {
      const obj = { user: { profile: { name: 'John' } } };
      const result = setValueAtPath(obj, 'user.profile.age', 30);
      
      expect(result).toEqual({
        user: {
          profile: {
            name: 'John',
            age: 30
          }
        }
      });
    });

    it('should create nested objects as needed', () => {
      const obj = {};
      const result = setValueAtPath(obj, 'deep.nested.path', 'value');
      
      expect(result).toEqual({
        deep: {
          nested: {
            path: 'value'
          }
        }
      });
    });

    it('should not mutate original object', () => {
      const obj = { name: 'test' };
      const result = setValueAtPath(obj, 'value', 42);
      
      expect(obj).toEqual({ name: 'test' });
      expect(result).toEqual({ name: 'test', value: 42 });
    });
  });

  describe('identity', () => {
    it('should return the same value', async () => {
      const value = { test: 'value' };
      const result = await identity()(value);
      
      expect(result).toBe(value);
    });
  });

  describe('compose', () => {
    it('should compose two functions correctly', async () => {
      const f = (state: any) => Promise.resolve({ ...state, value: state.value * 2 });
      const g = (state: any) => Promise.resolve({ ...state, value: state.value + 1 });
      
      const composed = compose(f, g);
      const result = await composed({ value: 5 });
      
      expect(result.value).toBe(12); // (5 + 1) * 2
    });
  });

  describe('composeAll', () => {
    it('should compose multiple functions from right to left', async () => {
      const f1 = (state: any) => Promise.resolve({ ...state, value: state.value + 1 });
      const f2 = (state: any) => Promise.resolve({ ...state, value: state.value * 2 });
      const f3 = (state: any) => Promise.resolve({ ...state, value: state.value - 1 });
      
      const composed = composeAll(f1, f2, f3);
      const result = await composed({ value: 5 });
      
      expect(result.value).toBe(11); // ((5 - 1) * 2) + 1
    });
  });
});
