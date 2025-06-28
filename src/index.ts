/*
 *  agentfx.ts — v1.3 (slim public API)
 *  -----------------------------------------------------------------------------
 *  Public surface (default export `Fx`):
 *    debug(fn)                           // attach debug hook
 *    tool(name, impl)(...args)           // deterministic step builder
 *    prompt(name, buildFn, llm)          // stochastic LLM step
 *    registerTool / callTool             // MCP registry (Zod‑validated)
 *    focus(path, step)                   // lens shortcut for slice updates
 *    sequence • parallel • loopWhile     // composition operators
 *    agent(name, workflow)               // Start/Stop wrapper
 *    spawn(workflow, seed)               // fire‑and‑forget run
 *  Hidden: sinks, rate‑limit, retry, cache, lenses, etc.
 */

// --------------------------------------------------------
// Standard deps
// --------------------------------------------------------
import crypto from "crypto";
import { createWriteStream, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { z, ZodTypeAny } from "zod";

// --------------------------------------------------------
// _Core (internal)
// --------------------------------------------------------
// Global registry for tools
interface Registered<S,Z extends ZodTypeAny>{ schema:Z; factory:(...a:z.infer<Z>)=>_Core.Step<S>; }
const registry = new Map<string, Registered<any,ZodTypeAny>>();

// Helper functions for JSON parsing
function cleanJsonResponse(text: string): string {
  // Remove markdown code block markers
  let cleaned = text.replace(/```(json|javascript|js|typescript|ts|\w*)?\n?/g, '');
  cleaned = cleaned.replace(/```\n?$/g, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // Try to find JSON content if still not valid
  if (!isValidJson(cleaned)) {
    const possibleJson = extractJsonFromText(text);
    if (possibleJson) {
      cleaned = possibleJson;
    }
  }
  
  return cleaned;
}

function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

function extractJsonFromText(text: string): string | null {
  // Find content within square brackets (array) or curly braces (object)
  // Use a more compatible approach without 's' flag
  const lines = text.split('\n');
  const fullText = lines.join(' ');
  
  // Look for array of objects
  let bracketCount = 0;
  let startPos = -1;
  let endPos = -1;
  
  // Find the first complete JSON array or object in the text
  for (let i = 0; i < fullText.length; i++) {
    const char = fullText[i];
    
    if (char === '[' && startPos === -1) {
      startPos = i;
      bracketCount = 1;
    } else if (char === '{' && startPos === -1) {
      startPos = i;
      bracketCount = 1;
    } else if (startPos !== -1) {
      if ((char === '[' || char === '{') && startPos !== -1) {
        bracketCount++;
      } else if ((char === ']' || char === '}') && startPos !== -1) {
        bracketCount--;
        if (bracketCount === 0) {
          endPos = i + 1;
          break;
        }
      }
    }
  }
  
  if (startPos !== -1 && endPos !== -1) {
    return fullText.substring(startPos, endPos);
  }
  
  return null;
}

namespace _Core {
  // ---------- utils ----------
  const json = (v: unknown) => {
    if (v === null || v === undefined) return JSON.stringify(v);
    return JSON.stringify(v, Object.keys(v as any).sort());
  };
  const sha = (s: string | null | undefined) => {
    if (s === null || s === undefined) return "empty";
    return crypto.createHash("sha256").update(s).digest("hex");
  };
  export const hash = <T>(t:T) => sha(json(t));
  const sleep= (ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
  export const clone=<T>(v:T):T=>structuredClone(v) as T;

  // ---------- types ----------
  export interface Event<S,A extends readonly unknown[]=readonly unknown[]> {
    readonly id:string; readonly name:string; readonly args:A; readonly ts:string;
    readonly beforeHash:string; readonly afterHash:string;
    readonly meta?: Readonly<Record<string,unknown>>;
  }
  export type Ledger<S> = Event<S,unknown[]>[];
  export type Step<S>   = (state:Readonly<S>, log:Ledger<S>)=>Promise<S>|S;

  // ---------- durable sink ----------
  const fileSink=(path=resolve("ledgers/ledger.jsonl"))=>{
    if(!existsSync(dirname(path))) mkdirSync(dirname(path),{recursive:true});
    const ws=createWriteStream(path,{flags:"a"});
    const sink = async (e:any)=>{ 
      try {
        if(!ws.write(json(e)+"\n")) await new Promise<void>(r=>ws.once("drain", () => r())); 
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    };
    // Add a close method to the sink function
    (sink as any).close = () => {
      ws.end();
    };
    return sink;
  };
  
  // Define a type that includes an optional close method
  type SinkFunction = ((e: any) => Promise<void>) & { 
    close?: () => void 
  };
  
  let sink: SinkFunction = fileSink();
  export const setSink=(fn: SinkFunction)=>{sink=fn;};
  export const closeSink = () => {
    // This is a no-op for custom sinks, but will close file streams
    if (sink.close) sink.close();
  };

  // ---------- debug ----------
  let dbg:(e:any,s:any)=>unknown;
  export const debugHook=(fn:(e:any,s:any)=>unknown)=>{dbg=fn;};

  // ---------- record helper ----------
  export function record<S,A extends readonly unknown[]>(log:Ledger<S>, ev:Event<S,A>, snap:S){
    log.push(ev as any); 
    return sink(ev).then(() => dbg?.(ev,snap));
  }

  // ---------- resilience ----------
  const CFG={qps:5,retry:{n:3,delay:200,back:2},ttl:60_000};
  const cache=new Map<string,{ts:number,v:unknown}>();
  const buckets=new Map<string,{tok:number,ts:number}>();
  const token=async(n:string)=>{const now=Date.now();const b=buckets.get(n)??{tok:CFG.qps,ts:now};b.tok=Math.min(CFG.qps,b.tok+((now-b.ts)/1000)*CFG.qps);b.ts=now;if(b.tok>=1){b.tok-=1;buckets.set(n,b);return;}await sleep(1000/CFG.qps);return token(n);};
  const withRetry=<S>(fn:Step<S>,n:string):Step<S>=>async(s,l)=>{for(let i=0,delay=CFG.retry.delay;;i++){try{return await fn(s,l);}catch(err){if(i+1>=CFG.retry.n)throw err; record(l,{id:crypto.randomUUID(),name:`retry:${n}`,args:[],ts:new Date().toISOString(),beforeHash:hash(s),afterHash:hash(s),meta:{err:(err as Error).message,attempt:i+1}} as Event<S,[]>,s);await sleep(delay);delay*=CFG.retry.back;}}};
  export const wrap=<S>(n:string,inner:Step<S>):Step<S>=>async(s,l)=>{const key=`${n}|${hash(s)}`;const c=cache.get(key) as any;if(c&&Date.now()-c.ts<CFG.ttl)return c.v;await token(n);const v=await withRetry(inner,n)(s,l);cache.set(key,{ts:Date.now(),v});return v;};

  // ---------- lenses ----------
  export interface Lens<S,T>{ get:(s:Readonly<S>)=>T; set:(t:T,s:Readonly<S>)=>S; path?:string; }
  export const pathLens=<S>(...p:(string|number)[]):Lens<S,unknown>=>({
    get:s=>p.reduce<any>((acc,k)=>acc[k as any],s),
    set:(v,s)=>{
      // Recursive immutable set with special handling for arrays
      const rec=(o:any,i:number):any=>{
        if(i===p.length) return v;
        
        const key = p[i];
        const childValue = o[key as any];
        const newChild = rec(childValue, i+1);
        
        // Special handling for arrays - create a new array and assign properties
        if (Array.isArray(o)) {
          const newArray = [...o];
          newArray[key as number] = newChild;
          return newArray;
        }
        
        // For objects, use spread operator for immutable updates
        return {...o, [key]: newChild};
      };
      return rec(s,0);
    },
    path:p.join(".")
  });
  
  // Deep freeze objects in development mode to catch mutations
  const deepFreeze = <T>(obj: T): T => {
    // Only run in development environment
    if (process.env.NODE_ENV !== 'production') {
      if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        Object.getOwnPropertyNames(obj).forEach(prop => {
          const value = obj as Record<string, any>;
          if (value[prop] !== null && 
              (typeof value[prop] === 'object' || typeof value[prop] === 'function') &&
              !Object.isFrozen(value[prop])) {
            deepFreeze(value[prop]);
          }
        });
      }
    }
    return obj;
  };
  
  export const lensMap=<S,T>(lens:Lens<S,T>,st:Step<T>):Step<S>=>async(s,l)=>{
    // Calculate beforeHash after making a copy to ensure immutability
    const sCopy = clone(s);
    const beforeHash = hash(sCopy);
    
    // Get the slice to update
    const b = lens.get(sCopy);
    
    // Deep freeze in development mode to catch mutations
    deepFreeze(b);
    
    // Apply the step function
    const a = await st(b, l as any);
    
    // Check for mutations (dev mode only)
    if (process.env.NODE_ENV !== 'production' && b === a && Object.isFrozen(a)) {
      // If frozen object is returned unchanged, it might indicate mutation
      console.warn('Warning: Lens step returned the same frozen object. This may indicate state was mutated in-place.');
    }
    
    // If no change, return original state
    if (a === b) return sCopy as S;
    
    // Update the state immutably
    const n = lens.set(a, sCopy);
    
    // Calculate afterHash on the final state
    const afterHash = hash(n);
    
    // Record the event
    record(l, {
      id: crypto.randomUUID(),
      name: "lens",
      args: [],
      ts: new Date().toISOString(),
      beforeHash,
      afterHash,
      meta: {path: lens.path}
    }, n);
    
    return n;
  };

  // ---------- MCP registry ----------
  export function registerTool<S,Z extends ZodTypeAny>(
    name: string, 
    schema: Z, 
    implementationFn: (...args: z.infer<Z>) => (state: Readonly<S>) => S | Promise<S>
  ): void {
    if (registry.has(name)) {
      console.warn(`Tool ${name} already registered. Skipping.`);
      return;
    }
    
    // Create factory function that follows lens pattern
    const factory = (...args: z.infer<Z>) => wrap(
      `tool:${name}`,
      async (state: Readonly<S>, log) => {
        // Apply the implementation function with args
        // Deep freeze the state to catch mutations
        const frozenState = deepFreeze(clone(state));
        const newState = await Promise.resolve(implementationFn(...args)(frozenState));
        
        // Record the event with args explicitly included
        record(log, {
          id: crypto.randomUUID(),
          name: `tool:${name}`,
          args: args as unknown as readonly unknown[],
          ts: new Date().toISOString(),
          beforeHash: hash(state),
          afterHash: hash(newState)
        }, newState);
        
        return newState;
      }
    );
    
    // Add to registry
    registry.set(name, { schema, factory } as Registered<any,ZodTypeAny>);
  }

  export const callTool = <S>(name:string, params:unknown[]): Step<S> => {
    const r = registry.get(name) as Registered<S,ZodTypeAny> | undefined;
    if (!r) throw new Error(`Unregistered tool: ${name}`);
    return r.factory(...r.schema.parse(params));
  };
}

// --------------------------------------------------------
// Public Facade
// --------------------------------------------------------

const Fx = {
  // debug
  debug: _Core.debugHook,

  // builders
  action: <S,P extends readonly unknown[]>(name:string,impl:(...p:P)=>(s:Readonly<S>)=>S)=>
            (...p:P)=> _Core.wrap(name,(s: Readonly<S>, l) => {
              // Apply the implementation function with args to get the new state
              const o = impl(...p)(s);
              
              // Create event with args explicitly included
              const event: _Core.Event<S,P> = {
                id: crypto.randomUUID(),
                name,
                args: p,  // Include the actual arguments
                ts: new Date().toISOString(),
                beforeHash: _Core.hash(s),
                afterHash: _Core.hash(o)
              };
              
              // Record the event with args
              _Core.record(l, event, o);
              return o;
            }),

  prompt: <S>(name:string,build:(s:Readonly<S>)=>string,llm:(p:string)=>Promise<string>)=>
            _Core.wrap(name,async(s: Readonly<S>, l) => {
              const txt = build(s);
              const rep = await llm(txt);
              _Core.record(l, {id:crypto.randomUUID(),name,args:[txt] as const,ts:new Date().toISOString(),beforeHash:_Core.hash(s),afterHash:_Core.hash(s),meta:{rep}} as _Core.Event<S,readonly[string]>, s);
              return s as S;
            }),

  // DX helpers - lens utility functions
  set: <S, V>(path: string|readonly(string|number)[], value: V): _Core.Step<S> => 
    _Core.lensMap(_Core.pathLens(...(Array.isArray(path)?path:[path])), 
      (_, l) => {
        _Core.record(l, {
          id: crypto.randomUUID(),
          name: `set:${Array.isArray(path) ? path.join('.') : path}`,
          args: [value] as const,
          ts: new Date().toISOString(),
          beforeHash: _Core.hash(_),
          afterHash: _Core.hash(value),
        } as _Core.Event<any, readonly[V]>, value as any);
        return value as any;
      }
    ),
    
  update: <S, T>(path: string|readonly(string|number)[], fn: (value: T) => T): _Core.Step<S> => 
    _Core.lensMap(_Core.pathLens(...(Array.isArray(path)?path:[path])), 
      (value, l) => {
        const newValue = fn(value as T);
        _Core.record(l, {
          id: crypto.randomUUID(),
          name: `update:${Array.isArray(path) ? path.join('.') : path}`,
          args: [] as const,
          ts: new Date().toISOString(),
          beforeHash: _Core.hash(value),
          afterHash: _Core.hash(newValue),
        } as _Core.Event<any, readonly[]>, newValue as any);
        return newValue as any;
      }
    ),
    
  push: <S, T>(path: string|readonly(string|number)[], item: T): _Core.Step<S> => 
    _Core.lensMap(_Core.pathLens(...(Array.isArray(path)?path:[path])), 
      (array, l) => {
        if (!Array.isArray(array)) {
          console.error(`Cannot push to non-array at path ${Array.isArray(path) ? path.join('.') : path}`);
          return array;
        }
        const newArray = [...array, item];
        _Core.record(l, {
          id: crypto.randomUUID(),
          name: `push:${Array.isArray(path) ? path.join('.') : path}`,
          args: [item] as const,
          ts: new Date().toISOString(),
          beforeHash: _Core.hash(array),
          afterHash: _Core.hash(newArray),
        } as _Core.Event<any, readonly[T]>, newArray as any);
        return newArray;
      }
    ),
    
  remove: <S>(path: string|readonly(string|number)[], predicate: ((item: any, index: number) => boolean) | number): _Core.Step<S> => 
    _Core.lensMap(_Core.pathLens(...(Array.isArray(path)?path:[path])), 
      (array, l) => {
        if (!Array.isArray(array)) {
          console.error(`Cannot remove from non-array at path ${Array.isArray(path) ? path.join('.') : path}`);
          return array;
        }
        
        let newArray: any[];
        if (typeof predicate === 'number') {
          // Remove by index
          newArray = [...array.slice(0, predicate), ...array.slice(predicate + 1)];
        } else {
          // Remove by predicate function
          newArray = array.filter((item, index) => !predicate(item, index));
        }
        
        _Core.record(l, {
          id: crypto.randomUUID(),
          name: `remove:${Array.isArray(path) ? path.join('.') : path}`,
          args: [typeof predicate === 'number' ? predicate : 'byPredicate'] as const,
          ts: new Date().toISOString(),
          beforeHash: _Core.hash(array),
          afterHash: _Core.hash(newArray),
        } as _Core.Event<any, readonly[any]>, newArray as any);
        return newArray;
      }
    ),
    
  // Extract helper for LLM prompt, parse and update
  extract: <S, T>({
    name,
    prompt,
    schema,
    fallback,
    path,
    llm: customLlm
  }: {
    name: string,
    prompt: (s: Readonly<S>) => string,
    schema: z.ZodType<T>,
    fallback: T[],
    path: string|readonly(string|number)[],
    llm?: (p: string) => Promise<string>
  }): _Core.Step<S> => _Core.wrap(`extract:${name}`, async (state, log) => {
    // 1. Get the prompt and run through LLM
    const promptText = prompt(state);
    const llmFn = customLlm || (global as any).llm;
    
    if (!llmFn) {
      throw new Error('No LLM function provided or found in global scope');
    }
    
    // Step 1: Call LLM and log the raw response
    const rawResponse = await llmFn(promptText);
    const stateAfterPrompt = await Fx.prompt<S>(
      `${name}:prompt`,
      () => promptText,
      async () => rawResponse
    )(state, log);
    
    // Step 2: Parse the response
    try {
      // Try to parse JSON from the response
      let items: T[] = [];
      
      // Clean up the response to handle markdown-formatted JSON
      const cleanedResponse = cleanJsonResponse(rawResponse);
      
      try {
        const json = JSON.parse(cleanedResponse);
        const parsed = Array.isArray(json) ? json : [json];
        
        // Validate with schema
        items = parsed.map(item => {
          try {
            return schema.parse(item);
          } catch (e) {
            console.warn(`Schema validation failed for item:`, item, e);
            return fallback[0];
          }
        });
      } catch (e) {
        console.warn(`JSON parse failed for: ${cleanedResponse.substring(0, 100)}...`, e);
        
        // Try a more aggressive extraction approach
        try {
          const extractedJson = extractJsonFromText(rawResponse);
          if (extractedJson) {
            const json = JSON.parse(extractedJson);
            const parsed = Array.isArray(json) ? json : [json];
            
            items = parsed.map(item => {
              try {
                return schema.parse(item);
              } catch (e) {
                console.warn(`Schema validation failed for extracted item:`, item, e);
                return fallback[0];
              }
            });
            
            if (items.length > 0) {
              console.log(`Recovered ${items.length} valid items using JSON extraction`);
            }
          }
        } catch (extractError) {
          console.warn(`Failed to extract JSON:`, extractError);
        }
        
        // If still empty, use fallback
        if (items.length === 0) {
          items = [...fallback];
        }
      }
      
      // If parsing failed, use fallback
      if (items.length === 0) {
        console.warn(`No valid items found, using fallback`);
        items = [...fallback];
      }
      
      // Step 3: Update the state with parsed items
      return await Fx.set<S, T[]>(path, items)(stateAfterPrompt, log);
    } catch (error) {
      console.error(`Error in extract:${name}:`, error);
      return await Fx.set<S, T[]>(path, [...fallback])(stateAfterPrompt, log);
    }
  }),
  
  // Resilience decorators
  retry: <S>(
    step: _Core.Step<S>, 
    opts: { attempts?: number, delay?: number, backoff?: number } = {}
  ): _Core.Step<S> => {
    const attempts = opts.attempts || 3;
    const initialDelay = opts.delay || 200;
    const backoff = opts.backoff || 2;
    
    return _Core.wrap(`retry:${step.name || 'anonymous'}`, async (state, log) => {
      let currentDelay = initialDelay;
      let lastError: Error | null = null;
      
      for (let i = 0; i < attempts; i++) {
        try {
          return await step(state, log);
        } catch (error) {
          lastError = error as Error;
          
          // Log retry attempt
          await _Core.record(log, {
            id: crypto.randomUUID(),
            name: `retry-attempt`,
            args: [i + 1, attempts] as const,
            ts: new Date().toISOString(),
            beforeHash: _Core.hash(state),
            afterHash: _Core.hash(state),
            meta: { error: (error as Error).message }
          } as _Core.Event<S, readonly[number, number]>, state);
          
          // Last attempt? Don't delay
          if (i === attempts - 1) {
            break;
          }
          
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          currentDelay *= backoff;
        }
      }
      
      // All retries failed
      throw lastError || new Error('Retry failed');
    });
  },
  
  throttle: <S>(
    step: _Core.Step<S>,
    qps: number
  ): _Core.Step<S> => {
    const buckets = new Map<string, { tokens: number, lastRefill: number }>();
    const refillInterval = 1000 / qps; // ms between token refills
    
    return _Core.wrap(`throttle:${step.name || 'anonymous'}`, async (state, log) => {
      const key = step.name || 'default';
      let bucket = buckets.get(key) || { tokens: qps, lastRefill: Date.now() };
      
      // Refill tokens based on time elapsed
      const now = Date.now();
      const elapsed = now - bucket.lastRefill;
      const tokensToAdd = Math.floor(elapsed / refillInterval);
      
      if (tokensToAdd > 0) {
        bucket.tokens = Math.min(qps, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;
      }
      
      // If no tokens available, wait until next refill
      if (bucket.tokens < 1) {
        const waitTime = refillInterval - (elapsed % refillInterval);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        bucket.tokens = 1;
        bucket.lastRefill = Date.now();
      }
      
      // Consume a token
      bucket.tokens--;
      buckets.set(key, bucket);
      
      // Execute the step
      return await step(state, log);
    });
  },

  // Add concurrency control to limit parallel executions
  concurrency: <S>(
    step: _Core.Step<S>,
    limit: number
  ): _Core.Step<S> => {
    // Limit must be at least 1
    const concurrencyLimit = Math.max(1, limit);
    const queue: Array<{
      state: Readonly<S>;
      log: _Core.Ledger<S>;
      resolve: (result: S) => void;
      reject: (error: any) => void;
    }> = [];
    let running = 0;
    
    // Process next item in queue when a slot becomes available
    const processQueue = () => {
      if (queue.length === 0 || running >= concurrencyLimit) return;
      
      const next = queue.shift();
      if (!next) return;
      
      running++;
      try {
        // Ensure we have a Promise by using Promise.resolve
        Promise.resolve(step(next.state, next.log))
          .then(next.resolve)
          .catch(next.reject)
          .finally(() => {
            running--;
            processQueue();
          });
      } catch (error) {
        next.reject(error);
        running--;
        processQueue();
      }
    };
    
    return _Core.wrap(`concurrency:${step.name || 'anonymous'}`, async (state, log) => {
      // If we're under the limit, execute immediately
      if (running < concurrencyLimit) {
        running++;
        try {
          const result = await step(state, log);
          running--;
          processQueue();
          return result;
        } catch (error) {
          running--;
          processQueue();
          throw error;
        }
      }
      
      // Otherwise, queue for later execution
      return new Promise<S>((resolve, reject) => {
        queue.push({ state, log, resolve, reject });
      });
    });
  },

  // lens helper
  focus: <S>(path:string|readonly(string|number)[], inner:_Core.Step<any>): _Core.Step<S> =>
           _Core.lensMap(_Core.pathLens(...(Array.isArray(path)?path:[path])), inner),

  // MCP registry
  registerTool: _Core.registerTool,
  callTool:     _Core.callTool,

  // composition
  sequence: <S>(...st:readonly _Core.Step<S>[]):_Core.Step<S>=>async(s,l)=>{let c=s as S;for(const fn of st)c=await fn(c,l);return c;},
  parallel: <S>(...st:readonly _Core.Step<S>[]):_Core.Step<S>=>async(s,l)=>{const r=await Promise.all(st.map(fn=>fn(_Core.clone(s),l)));return r[r.length-1];},
  loopWhile:<S>(p:(s:Readonly<S>)=>boolean,b:_Core.Step<S>):_Core.Step<S>=>async(s,l)=>{let c=s as S;while(p(c))c=await b(c,l);return c;},
  wrap: _Core.wrap,

  // orchestration
  agent: <S>(name:string,wf:_Core.Step<S>):_Core.Step<S>=>async(s,l)=>{
    await _Core.record(l,{id:crypto.randomUUID(),name:`start:${name}`,args:[],ts:new Date().toISOString(),beforeHash:_Core.hash(s),afterHash:_Core.hash(s)},s);
    const n=await wf(s,l);
    await _Core.record(l,{id:crypto.randomUUID(),name:`stop:${name}`,args:[],ts:new Date().toISOString(),beforeHash:_Core.hash(n),afterHash:_Core.hash(n)},n);
    return n;
  },
  spawn: async <S>(wf:_Core.Step<S>, seed:S): Promise<S> => {
    const log: _Core.Ledger<S> = [];
    const result = await wf(seed, log);
    
    // Give any pending sink operations time to complete
    return new Promise(resolve => {
      setTimeout(() => {
        if (_Core.closeSink) _Core.closeSink();
        resolve(result);
      }, 500);
    });
  },
  extractResponse: (log: any[]): string => log[log.length - 1]?.meta?.rep ?? "",
  newId: () => crypto.randomUUID(),
  promptAndExtract: <S>(name: string, build: (s: Readonly<S>) => string, llm: (p: string) => Promise<string>) =>
    async (s: S, log: any[]): Promise<[S, string]> => {
      const newState = await Fx.prompt(name, build, llm)(s, log);
      return [newState, Fx.extractResponse(log)];
    },
} as const;

export default Fx;
