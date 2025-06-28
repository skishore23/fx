// underwritingAgent.ts
//-----------------------------------------------------------------------
// 0. deps  ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import Fx from "./index";
import { z } from "zod";
import OpenAI from "openai";
import crypto from "crypto";

// Define Step type based on what's in index.ts
type Step<S> = (state: Readonly<S>, log: any) => Promise<S> | S;

// OpenAI client
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
interface Persona {
  id: string;
  name: string;
  role: string;
  prompt: string;
  response?: string;
  references: string[];
}

interface PolicyDetails {
  applicantName: string;
  vehicleInfo: string;
  coverage: string;
  drivingHistory: string;
}

interface UnderwritingState {
  rootId: string;
  policyDetails: PolicyDetails;
  personas: Record<string, Persona>;
  iteration: number;
  decision: {
    approved: boolean;
    terms: string;
    reasoning: string;
  };
}

// small helpers
const newId = () => crypto.randomUUID();

//-----------------------------------------------------------------------
// 2. MCP tools  ────────────────────────────────────────────────────────
Fx.registerTool<UnderwritingState, z.ZodTuple<[z.ZodString, z.ZodString, z.ZodString]>>(
  "addPersona",
  z.tuple([z.string(), z.string(), z.string()]),
  (name: string, role: string, prompt: string) =>
    Fx.tool("addPersona", () => (s: UnderwritingState) => {
      const id = newId();
      return {
        ...s,
        personas: {
          ...s.personas,
          [id]: { id, name, role, prompt, references: [] }
        }
      };
    })()
);

Fx.registerTool<UnderwritingState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "setResponse",
  z.tuple([z.string(), z.string()]),
  (id: string, response: string) => Fx.tool("setResponse", () => (s: UnderwritingState) =>
    ({ ...s, personas: { ...s.personas, [id]: { ...s.personas[id], response } } })
  )()
);

Fx.registerTool<UnderwritingState, z.ZodTuple<[z.ZodBoolean, z.ZodString, z.ZodString]>>(
  "makeDecision",
  z.tuple([z.boolean(), z.string(), z.string()]),
  (approved: boolean, terms: string, reasoning: string) => 
    Fx.tool("makeDecision", () => (s: UnderwritingState) => {
      // Create a new state with the decision added
      return {
        ...s,
        decision: {
          approved,
          terms,
          reasoning
        }
      };
    })()
);

//-----------------------------------------------------------------------
// 3. Prompt helpers  ───────────────────────────────────────────────────
const generateResponsePrompt = (personaId: string) => Fx.prompt<UnderwritingState>(
  `generateResponse:${personaId}`,
  s => {
    const persona = s.personas[personaId];
    const policy = s.policyDetails;
    
    // Build context from all previous responses
    const previousResponses = Object.values(s.personas)
      .filter(p => p.id !== personaId && p.response)
      .map(p => `${p.name} (${p.role}): ${p.response}`)
      .join('\n\n');
    
    return `You are ${persona.name}, ${persona.role}. 
    
Policy Application Details:
Applicant: ${policy.applicantName}
Vehicle: ${policy.vehicleInfo}
Coverage Requested: ${policy.coverage}
Driving History: ${policy.drivingHistory}

${persona.references.length > 0 ? `References:\n${persona.references.join('\n')}` : ''}

${previousResponses ? `Previous assessments:\n${previousResponses}` : ''}

Based on your role and the information provided, give your assessment of this auto insurance application. 
Be concise but thorough in your evaluation. Focus on risks, pricing considerations, and your recommendation.`;
  },
  llm
);

const finalDecisionPrompt = Fx.prompt<UnderwritingState>(
  `finalDecision`,
  s => {
    // Collate all persona responses
    const allResponses = Object.values(s.personas)
      .filter(p => p.response)
      .map(p => `${p.name} (${p.role}): ${p.response}`)
      .join('\n\n');
    
    return `You are the Senior Underwriter making the final decision on this auto insurance application:

Policy Application Details:
Applicant: ${s.policyDetails.applicantName}
Vehicle: ${s.policyDetails.vehicleInfo}
Coverage Requested: ${s.policyDetails.coverage}
Driving History: ${s.policyDetails.drivingHistory}

Team Assessment:
${allResponses}

Based on all assessments, make a final underwriting decision.
Output your decision in this JSON format:
{
  "approved": true/false,
  "terms": "Standard/Non-standard terms with specific conditions if approved",
  "reasoning": "Brief explanation of your decision"
}`;
  },
  llm
);

//-----------------------------------------------------------------------
// 4. Underwriting workflow  ─────────────────────────────────────────────
const processApplication: Step<UnderwritingState> = Fx.sequence(
  // 4.1 Each persona evaluates the application
  Fx.wrap("gatherAssessments", async (state: UnderwritingState, log: any) => {
    console.log("\n=== Insurance Application Assessment ===");
    console.log(`Applicant: ${state.policyDetails.applicantName}`);
    
    // Process each persona sequentially
    let currentState = state;
    for (const personaId of Object.keys(state.personas)) {
      const persona = state.personas[personaId];
      console.log(`\n--- ${persona.name} (${persona.role}) Assessment ---`);
      
      // Get response from LLM
      await generateResponsePrompt(personaId)(currentState, log);
      
      // Extract the response from the metadata of the last event
      const lastEvent = log[log.length - 1];
      const response = lastEvent?.meta?.rep || "";
      
      console.log(`${response.substring(0, 150)}...`);
      
      // Update the state with the response
      currentState = await Fx.callTool<UnderwritingState>("setResponse", [personaId, response])(currentState, log);
    }
    
    return currentState;
  }),

  // 4.2 Make final underwriting decision
  Fx.wrap("finalizeDecision", async (state: UnderwritingState, log: any) => {
    console.log("\n=== Final Underwriting Decision ===");
    
    // Call LLM for final decision
    await finalDecisionPrompt(state, log);
    
    // Extract decision from the metadata of the last event
    const lastEvent = log[log.length - 1];
    const decisionText = lastEvent?.meta?.rep || "{}";
    
    try {
      // Parse the JSON response
      const decision = JSON.parse(decisionText);
      console.log(`Decision: ${decision.approved ? "APPROVED" : "DECLINED"}`);
      console.log(`Terms: ${decision.terms}`);
      console.log(`Reasoning: ${decision.reasoning}`);
      
      // Update the state with the decision
      return await Fx.callTool<UnderwritingState>("makeDecision", [
        !!decision.approved,
        decision.terms || "",
        decision.reasoning || ""
      ])(state, log);
    } catch (err) {
      console.error("Error parsing decision:", err);
      return state;
    }
  })
);

//-----------------------------------------------------------------------
// 5. Agent wrapper  ─────────────────────────────────────────────────────
export const underwritingAgent = Fx.agent<UnderwritingState>(
  "UnderwritingAgent",
  processApplication
);

//-----------------------------------------------------------------------
// 6. Run demo if executed directly  ────────────────────────────────────
if (require.main === module) {
  // Create a clean ledger for this run
  const fs = require('fs');
  const path = require('path');
  
  const ledgerDir = path.resolve("ledgers");
  const ledgerPath = path.resolve(ledgerDir, "underwriting-ledger.jsonl");
  
  // Ensure directory exists
  if (!fs.existsSync(ledgerDir)) {
    fs.mkdirSync(ledgerDir, { recursive: true });
  }
  
  // Start with a fresh ledger file
  if (fs.existsSync(ledgerPath)) {
    fs.writeFileSync(ledgerPath, '');
  }
  
  // Sample policy application
  const seed: UnderwritingState = {
    rootId: "root",
    iteration: 0,
    policyDetails: {
      applicantName: "John Smith, 28 years old, single",
      vehicleInfo: "2021 Tesla Model 3, VIN: 5YJ3E1EA1MF713361",
      coverage: "Comprehensive with $500 deductible, Collision with $1000 deductible, Liability 100/300/50",
      drivingHistory: "One speeding ticket (15mph over) in last 3 years, no accidents"
    },
    personas: {},
    decision: {
      approved: false,
      terms: "",
      reasoning: "Pending assessment"
    }
  };
  
  // Add personas with their roles
  const withPersonas = Fx.sequence(
    Fx.callTool<UnderwritingState>("addPersona", [
      "Alex",
      "Insurance Agent",
      "You review the application details and verify customer information. You focus on customer needs and appropriate coverage options."
    ]),
    Fx.callTool<UnderwritingState>("addPersona", [
      "Taylor",
      "Underwriter",
      "You assess risk factors in the application based on underwriting guidelines. Consider driver history, vehicle type, and requested coverage."
    ]),
    Fx.callTool<UnderwritingState>("addPersona", [
      "Jordan",
      "Actuary",
      "You analyze the statistical risk and pricing implications. Provide quantitative assessment of premium adequacy based on risk factors."
    ])
  );
  
  // Minimal logging
  Fx.debug((ev, _) => {
    if (ev.name.startsWith('start:') || ev.name.startsWith('stop:')) {
      console.log(`${ev.name}`);
    }
  });

  // Run the agent
  Fx.spawn(Fx.sequence(withPersonas, underwritingAgent), seed)
    .then(final => {
      console.log("\n=== Final Decision Summary ===");
      if (final.decision) {
        console.log(`Application: ${final.decision.approved ? "APPROVED" : "DECLINED"}`);
        if (final.decision.approved) {
          console.log(`Terms: ${final.decision.terms}`);
        }
        console.log(`Reasoning: ${final.decision.reasoning}`);
      } else {
        console.log("No decision was reached.");
      }
    })
    .catch(err => {
      console.error("\nERROR in underwriting agent execution:");
      console.error(err);
      process.exitCode = 1;
    });
} 