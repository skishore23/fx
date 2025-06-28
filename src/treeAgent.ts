// treeAgentExample.ts
//-----------------------------------------------------------------------
// 0. deps  ─────────────────────────────────────────────────────────────
import 'dotenv/config'; // Load environment variables from .env file
import Fx from "./index";               // the v1.2 file in your canvas
import { z } from "zod";
import OpenAI from "openai";

// Define Step type based on what's in index.ts
type Step<S> = (state: Readonly<S>, log: any) => Promise<S> | S;

// OpenAI client (only key needed)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function llm(prompt: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0].message.content ?? "";
}

//-----------------------------------------------------------------------
// 1. Domain state  ─────────────────────────────────────────────────────
interface Node {
  id: string;
  prompt: string;
  answer?: string;
  score?: number;
  children: string[];
}
interface Tree {
  rootId: string;
  nodes: Record<string, Node>;
  iteration: number;
}

//-----------------------------------------------------------------------
// 2. Tools with direct Zod schemas and lenses ───────────────────────────
// Schema definitions
const AddChildSchema = z.tuple([z.string(), z.string()]);
const SetAnswerSchema = z.tuple([z.string(), z.string()]);
const SetScoreSchema = z.tuple([z.string(), z.number()]);

// Tool implementations with direct schemas
const addChild = (parentId: string, promptText: string): Step<Tree> => 
  Fx.sequence(
    // Update parent's children array
    Fx.focus<Tree>(['nodes', parentId, 'children'], Fx.action("updateParent", () => (children: readonly string[]) => 
      [...children, Fx.newId()]
    )()),
    // Add new node to nodes map
    Fx.action("addNodeEntry", () => (s: Tree) => {
      const id = s.nodes[parentId].children[s.nodes[parentId].children.length - 1];
      return {
        ...s,
        nodes: {
          ...s.nodes,
          [id]: { id, prompt: promptText, children: [] }
        }
      };
    })()
  );

const setAnswer = (id: string, ans: string): Step<Tree> => 
  Fx.focus<Tree>(['nodes', id, 'answer'], Fx.action("setAnswer", () => () => ans)());

const setScore = (id: string, score: number): Step<Tree> => 
  Fx.sequence(
    Fx.focus<Tree>(['nodes', id, 'score'], Fx.action("setScore", () => () => {
      console.log(`Setting score for node ${id.substring(0, 8)} to ${score}`);
      return score;
    })())
  );

//-----------------------------------------------------------------------
// 3. Prompt helpers  ───────────────────────────────────────────────────

//-----------------------------------------------------------------------
// 4. One iteration of "evolving tree"  ─────────────────────────────────
const iterate: Step<Tree> = Fx.sequence(
  // 4.1 propose three child prompts
  Fx.wrap("branching", async (state: Tree, log: any) => {
    // Use promptAndExtract to get both the updated state and response in one call
    const [updatedState, rawText] = await Fx.promptAndExtract<Tree>(
      "proposeChildren",
      s => `Generate three DIFFERENT follow-up questions (newline delimited) about:
"${s.nodes[s.rootId].prompt}"

Make each question explore a distinct aspect. Focus on:
1. Technical implementation details
2. Business or ethical considerations
3. Future developments or trends

Format as plain questions, each on a new line.`,
      llm
    )(state, log);
    
    // Process the response into individual questions
    const prompts = rawText
      .split(/\n+/)  // Split on one or more newlines
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 0)  // Remove empty lines
      .filter((p: string) => /\?$/.test(p) || p.length > 10)  // Keep only questions or substantial text
      .slice(0, 3);  // Take at most 3 questions
    
    console.log("\n=== Extracted Questions (Iteration " + (state.iteration + 1) + ") ===");
    prompts.forEach((p: string, i: number) => console.log(`${i+1}. ${p}`));
    
    // Add each child using direct tool call
    let cur = updatedState;
    for (const p of prompts) {
      // Validate parameters with schema before calling
      const [validParentId, validPrompt] = AddChildSchema.parse([state.rootId, p]);
      cur = await addChild(validParentId, validPrompt)(cur, log);
    }
    
    return cur;
  }),

  // 4.2 answer each leaf in parallel
  Fx.wrap("processAnswers", async (state: Tree, log: any) => {
    // Process each child sequentially to avoid state issues
    let currentState = state;
    for (const childId of state.nodes[state.rootId].children) {
      // Use promptAndExtract to get both the updated state and answer in one call
      const [stateAfterAnswer, answer] = await Fx.promptAndExtract<Tree>(
        `answer:${childId}`,
        s => `Answer concisely:\n${s.nodes[childId].prompt}`,
        llm
      )(currentState, log);
      
      // Validate parameters with schema
      const [validId, validAnswer] = SetAnswerSchema.parse([childId, answer]);
      
      // Update the state with the answer
      currentState = await setAnswer(validId, validAnswer)(stateAfterAnswer, log);
    }
    
    return currentState;
  }),

  // 4.3 score each answer sequentially
  Fx.wrap("processScores", async (state: Tree, log: any) => {
    // Process each child sequentially
    let currentState = state;
    for (const childId of state.nodes[state.rootId].children) {
      // Only score if there's an answer
      if (currentState.nodes[childId]?.answer) {
        // Use promptAndExtract to get both the updated state and score text in one call
        const [stateAfterScore, scoreText] = await Fx.promptAndExtract<Tree>(
          `score:${childId}`,
          s => `Rate 0-10 usefulness of answer:\n${s.nodes[childId].answer}`,
          llm
        )(currentState, log);
        
        // Parse score - extract first number from response or default to 0
        const scoreMatch = scoreText.match(/\d+/);
        const score = scoreMatch ? parseInt(scoreMatch[0], 10) : 0;
        
        console.log(`   Extracted score value: ${score} from response`);
        
        // Validate parameters with schema
        const [validId, validScore] = SetScoreSchema.parse([childId, score]);
        
        // Update the state with the score
        currentState = await setScore(validId, validScore)(stateAfterScore, log);
      } else {
        const [validId, validScore] = SetScoreSchema.parse([childId, 0]);
        currentState = await setScore(validId, validScore)(currentState, log);
      }
    }
    
    return currentState;
  }),

  // 4.4 prune low scores (<5)
  Fx.focus<Tree>('iteration', Fx.action("incrementIteration", () => (i: number) => i + 1)()),
  Fx.action("pruneNodes", () => (s: Tree) => {
    // Safety checks
    if (!s || !s.nodes || !s.rootId) {
      console.error("Invalid state object in pruneNodes");
      return s;
    }

    const rootId = s.rootId;
    const rootNode = s.nodes[rootId];
    
    if (!rootNode || !rootNode.children) {
      console.error("Root node or children missing");
      return s;
    }
    
    // Filter children to keep only those with scores >= 5
    const keptChildren = rootNode.children.filter(id => {
      const node = s.nodes[id];
      return node && (node.score ?? 0) >= 5;
    });
    
    // Get iteration for logging
    const iteration = s.iteration;
    
    console.log(`\n=== After Pruning (Iteration ${iteration}) ===`);
    console.log(`Questions kept: ${keptChildren.length}/${rootNode.children.length}`);
    
    // Update the state with filtered children
    return {
      ...s,
      nodes: {
        ...s.nodes,
        [rootId]: {
          ...rootNode,
          children: keptChildren
        }
      }
    };
  })(),
);

//-----------------------------------------------------------------------
// 5. Agent wrapper – run three generations  ────────────────────────────
export const treeAgent = Fx.agent<Tree>(
  "TreePlanner",
  Fx.wrap("loopController", async (state: Tree, log: any) => {
    console.log(`\n=== Starting Tree Planning ===`);
    console.log(`Root Question: "${state.nodes[state.rootId].prompt}"`);
    
    // Maximum number of iterations to run
    const maxIterations = 3;
    
    let currentState = state;
    while (currentState.iteration < maxIterations) {
      console.log(`\n--- Iteration ${currentState.iteration + 1} of ${maxIterations} ---`);
      currentState = await iterate(currentState, log);
    }
    
    return currentState;
  })
);

//-----------------------------------------------------------------------
// 6. Run demo if executed directly  ────────────────────────────────────
if (require.main === module) {
  // Create a clean ledger for this run
  const fs = require('fs');
  const path = require('path');
  
  const ledgerDir = path.resolve("ledgers");
  const ledgerPath = path.resolve(ledgerDir, "ledger.jsonl");
  
  // Ensure directory exists
  if (!fs.existsSync(ledgerDir)) {
    fs.mkdirSync(ledgerDir, { recursive: true });
  }
  
  // Start with a fresh ledger file
  if (fs.existsSync(ledgerPath)) {
    fs.writeFileSync(ledgerPath, '');
  }
  
  const seed: Tree = {
    iteration: 0,
    rootId: "root",
    nodes: {
      root: { id: "root", prompt: "How to reduce insurance fraud with AI?", children: [] }
    }
  };

  // Set up comprehensive debug logging
  Fx.debug((ev, state) => {
    // Create detailed debug logs based on event type
    const timestamp = new Date(ev.ts).toLocaleTimeString();
    
    // Format different events differently
    switch (true) {
      case ev.name === 'proposeChildren':
        console.log(`[${timestamp}] 🌱 PROMPT: Generated questions from "${(state as Tree).nodes[(state as Tree).rootId].prompt}"`);
        if (ev.meta?.rep) {
          const response = ev.meta.rep as string;
          console.log(`   Response preview: ${response.substring(0, 50)}${response.length > 50 ? '...' : ''}`);
        }
        break;
        
      case ev.name.startsWith('answer:'):
        const nodeId = ev.name.split(':')[1];
        const prompt = (state as Tree).nodes[nodeId]?.prompt;
        // Truncate with ellipsis for longer prompts
        const formattedPrompt = prompt ? 
          (prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt) : '';
        console.log(`[${timestamp}] ✍️ ANSWER: Processing answer for "${formattedPrompt}"`);
        break;
        
      case ev.name.startsWith('score:'):
        const nodeIdFromName = ev.name.split(':')[1];
        console.log(`[${timestamp}] 🔢 SCORE: Rating answer for node ${nodeIdFromName}`);
        break;
        
      case ev.name === 'pruneNodes':
        const treeState = state as Tree;
        console.log(`[${timestamp}] ✂️ PRUNE: Pruning low-scoring nodes (iteration ${treeState.iteration})`);
        console.log(`   Hash: ${ev.afterHash.substring(0, 8)}`);
        break;
        
      case ev.name.startsWith('start:'):
        console.log(`[${timestamp}] 🚀 START: ${ev.name.substring(6)} process beginning`);
        break;
        
      case ev.name.startsWith('stop:'):
        console.log(`[${timestamp}] 🏁 FINISH: ${ev.name.substring(5)} process complete`);
        break;
        
      case ev.name === 'updateParent':
      case ev.name === 'addNodeEntry':
        console.log(`[${timestamp}] 📝 TOOL: Adding new child node (${ev.name})`);
        break;
        
      case ev.name === 'setAnswer':
        console.log(`[${timestamp}] 📝 TOOL: Setting answer`);
        break;
        
      case ev.name === 'setScore':
        // Look for score info in the event args
        const scoreNodeId = ev.args && ev.args.length > 0 ? ev.args[0] : undefined;
        const scoreValue = ev.args && ev.args.length > 1 ? ev.args[1] : undefined;
        
        if (scoreNodeId && scoreValue !== undefined) {
          console.log(`[${timestamp}] 📝 TOOL: Setting score for node ${scoreNodeId.substring(0, 8)} to ${scoreValue}`);
        } else {
          // Fallback to state inspection if args aren't available
          console.log(`[${timestamp}] 📝 TOOL: Score update event`);
          console.log(`   Event ID: ${ev.id.substring(0, 8)}`);
        }
        break;
        
      case ev.name === 'incrementIteration':
        console.log(`[${timestamp}] 🔄 TOOL: Incrementing iteration counter`);
        break;
        
      case ev.name === 'lens':
        // Extract path from meta if available
        const path = ev.meta?.path || 'unknown path';
        console.log(`[${timestamp}] 🔍 LENS: Update at path "${path}"`);
        break;
        
      default:
        console.log(`[${timestamp}] ⚙️ EVENT: ${ev.name}`);
    }
  });

  console.log("\n=== Debug Enabled Tree Planning Agent ===");
  console.log("Starting with seed question: " + seed.nodes[seed.rootId].prompt);
  console.log("==========================================");

  // Run the agent with comprehensive error handling
  Fx.spawn(treeAgent, seed)
    .then(final => {
      console.log("\n=== Final Results ===");
      
      // Print a summary of the final state
      const rootChildren = final.nodes[final.rootId].children;
      console.log(`Starting question: "${final.nodes[final.rootId].prompt}"`);
      console.log(`Final high-scoring questions (${rootChildren.length}):`);
      
      // Show the questions that survived pruning with improved formatting
      rootChildren.forEach((childId, i) => {
        const child = final.nodes[childId];
        console.log(`\n${i+1}. ${child.prompt}`);
        console.log(`   Score: ${child.score}/10`);
        
        // Format the answer with better wrapping
        if (child.answer) {
          // Split answer into lines of max 80 chars for better readability
          const formattedAnswer = child.answer
            .split(/\s+/)
            .reduce((lines, word) => {
              const lastLine = lines[lines.length - 1];
              if (lastLine.length + word.length + 1 <= 80) {
                lines[lines.length - 1] = lastLine ? `${lastLine} ${word}` : word;
              } else {
                lines.push(word);
              }
              return lines;
            }, [''])
            .join('\n      ');
            
          console.log(`   Answer: ${formattedAnswer}`);
        } else {
          console.log(`   Answer: No answer available`);
        }
      });
    })
    .catch(err => {
      console.error("\nERROR in tree agent execution:");
      console.error(err);
      process.exitCode = 1;
    });
}
