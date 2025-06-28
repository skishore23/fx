// carePlanAgent.ts
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
interface TeamMember {
  id: string;
  name: string;
  role: string;
  prompt: string;
  response?: string;
  recommendation?: string;
  references: string[];
}

interface PatientInfo {
  name: string;
  age: number;
  condition: string;
  medicalHistory: string;
  homeEnvironment: string;
}

interface CarePlanState {
  rootId: string;
  patientInfo: PatientInfo;
  teamMembers: Record<string, TeamMember>;
  iteration: number;
  finalCarePlan: {
    clinicalRecommendations: string[];
    homeServices: string[];
    followUpSchedule: string;
    safetyMeasures: string[];
    caregiverInstructions: string;
  };
}

// small helpers
const newId = () => crypto.randomUUID();

//-----------------------------------------------------------------------
// 2. MCP tools  ────────────────────────────────────────────────────────
Fx.registerTool<CarePlanState, z.ZodTuple<[z.ZodString, z.ZodString, z.ZodString]>>(
  "addTeamMember",
  z.tuple([z.string(), z.string(), z.string()]),
  (name: string, role: string, prompt: string) =>
    Fx.tool("addTeamMember", () => (s: CarePlanState) => {
      const id = newId();
      return {
        ...s,
        teamMembers: {
          ...s.teamMembers,
          [id]: { id, name, role, prompt, references: [] }
        }
      };
    })()
);

Fx.registerTool<CarePlanState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "setResponse",
  z.tuple([z.string(), z.string()]),
  (id: string, response: string) => Fx.tool("setResponse", () => (s: CarePlanState) =>
    ({ ...s, teamMembers: { ...s.teamMembers, [id]: { ...s.teamMembers[id], response } } })
  )()
);

Fx.registerTool<CarePlanState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "setRecommendation",
  z.tuple([z.string(), z.string()]),
  (id: string, recommendation: string) => Fx.tool("setRecommendation", () => (s: CarePlanState) =>
    ({ ...s, teamMembers: { ...s.teamMembers, [id]: { ...s.teamMembers[id], recommendation } } })
  )()
);

Fx.registerTool<CarePlanState, z.ZodTuple<[z.ZodArray<z.ZodString>, z.ZodArray<z.ZodString>, z.ZodString, z.ZodArray<z.ZodString>, z.ZodString]>>(
  "createCarePlan",
  z.tuple([
    z.array(z.string()),
    z.array(z.string()),
    z.string(),
    z.array(z.string()),
    z.string()
  ]),
  (
    clinicalRecommendations: string[],
    homeServices: string[],
    followUpSchedule: string,
    safetyMeasures: string[],
    caregiverInstructions: string
  ) => Fx.tool("createCarePlan", () => (s: CarePlanState) => ({
    ...s,
    finalCarePlan: {
      clinicalRecommendations,
      homeServices,
      followUpSchedule,
      safetyMeasures,
      caregiverInstructions
    }
  }))()
);

//-----------------------------------------------------------------------
// 3. Prompt helpers  ───────────────────────────────────────────────────
const generateAssessmentPrompt = (memberId: string) => Fx.prompt<CarePlanState>(
  `generateAssessment:${memberId}`,
  s => {
    const member = s.teamMembers[memberId];
    const patient = s.patientInfo;
    
    // Build context from all previous responses
    const previousResponses = Object.values(s.teamMembers)
      .filter(m => m.id !== memberId && m.response)
      .map(m => `${m.name} (${m.role}): ${m.response}`)
      .join('\n\n');
    
    return `You are ${member.name}, ${member.role}, creating a care plan for a patient recovering from surgery.
    
Patient Information:
Name: ${patient.name}
Age: ${patient.age}
Condition: ${patient.condition}
Medical History: ${patient.medicalHistory}
Home Environment: ${patient.homeEnvironment}

${member.references.length > 0 ? `References:\n${member.references.join('\n')}` : ''}

${previousResponses ? `Previous team assessments:\n${previousResponses}` : ''}

Based on your role and the information provided, assess this patient's needs and recommend approaches to support their recovery.
Be concise but thorough in your evaluation. Focus on your area of expertise and how it relates to this patient's specific situation.`;
  },
  llm
);

const generateRecommendationPrompt = (memberId: string) => Fx.prompt<CarePlanState>(
  `generateRecommendation:${memberId}`,
  s => {
    const member = s.teamMembers[memberId];
    const patient = s.patientInfo;
    
    // Build context from all team member assessments
    const allAssessments = Object.values(s.teamMembers)
      .filter(m => m.response)
      .map(m => `${m.name} (${m.role}): ${m.response}`)
      .join('\n\n');
    
    return `You are ${member.name}, ${member.role}, finalizing recommendations for ${patient.name}'s care plan.

Review the team's assessments and provide your final recommendations based on your expertise.

Team Assessments:
${allAssessments}

Provide a structured set of recommendations that focuses specifically on your area of expertise.
Keep your recommendations practical, specific to this patient's situation, and actionable by the care team.`;
  },
  llm
);

const finalizeCarePlanPrompt = Fx.prompt<CarePlanState>(
  `finalizeCarePlan`,
  s => {
    // Collate all team member recommendations
    const allRecommendations = Object.values(s.teamMembers)
      .filter(m => m.recommendation)
      .map(m => `${m.name} (${m.role}): ${m.recommendation}`)
      .join('\n\n');
    
    return `As the Care Planning Coordinator, you need to synthesize all team recommendations into a cohesive care plan for ${s.patientInfo.name}.

Patient Information:
Name: ${s.patientInfo.name}
Age: ${s.patientInfo.age}
Condition: ${s.patientInfo.condition}
Medical History: ${s.patientInfo.medicalHistory}
Home Environment: ${s.patientInfo.homeEnvironment}

Team Recommendations:
${allRecommendations}

YOUR RESPONSE MUST BE VALID JSON ONLY. Do not include any text before or after the JSON.

Create a comprehensive care plan in this exact JSON format:
{
  "clinicalRecommendations": ["List of medical/clinical recommendations"],
  "homeServices": ["List of home health services to arrange"],
  "followUpSchedule": "Timeline for follow-up appointments",
  "safetyMeasures": ["List of home safety measures to implement"],
  "caregiverInstructions": "Clear instructions for family caregivers"
}

Each component should be specific, actionable, and directly relevant to this patient's needs. 
DO NOT include any introduction, explanation, or conclusion text - ONLY the JSON object.`;
  },
  llm
);

//-----------------------------------------------------------------------
// 4. Care planning workflow  ────────────────────────────────────────────
const developCarePlan: Step<CarePlanState> = Fx.sequence(
  // 4.1 Each team member assesses the patient
  Fx.wrap("gatherAssessments", async (state: CarePlanState, log: any) => {
    console.log("\n=== Patient Care Assessment ===");
    console.log(`Patient: ${state.patientInfo.name}, ${state.patientInfo.age} years old`);
    console.log(`Condition: ${state.patientInfo.condition}`);
    
    // Process each team member sequentially
    let currentState = state;
    for (const memberId of Object.keys(state.teamMembers)) {
      const member = state.teamMembers[memberId];
      console.log(`\n--- ${member.name} (${member.role}) Assessment ---`);
      
      // Get assessment from LLM
      await generateAssessmentPrompt(memberId)(currentState, log);
      
      // Extract the response from the metadata of the last event
      const lastEvent = log[log.length - 1];
      const response = lastEvent?.meta?.rep || "";
      
      console.log(`${response.substring(0, 150)}...`);
      
      // Update the state with the response
      currentState = await Fx.callTool<CarePlanState>("setResponse", [memberId, response])(currentState, log);
    }
    
    return currentState;
  }),

  // 4.2 Each team member provides final recommendations
  Fx.wrap("collectRecommendations", async (state: CarePlanState, log: any) => {
    console.log("\n=== Team Recommendations ===");
    
    // Process each team member sequentially
    let currentState = state;
    for (const memberId of Object.keys(state.teamMembers)) {
      const member = state.teamMembers[memberId];
      console.log(`\n--- ${member.name} (${member.role}) Recommendations ---`);
      
      // Get recommendations from LLM
      await generateRecommendationPrompt(memberId)(currentState, log);
      
      // Extract the recommendation from the metadata of the last event
      const lastEvent = log[log.length - 1];
      const recommendation = lastEvent?.meta?.rep || "";
      
      console.log(`${recommendation.substring(0, 150)}...`);
      
      // Update the state with the recommendation
      currentState = await Fx.callTool<CarePlanState>("setRecommendation", [memberId, recommendation])(currentState, log);
    }
    
    return currentState;
  }),

  // 4.3 Finalize care plan
  Fx.wrap("finalizeCarePlan", async (state: CarePlanState, log: any) => {
    console.log("\n=== Final Care Plan Development ===");
    
    // Call LLM for final care plan
    await finalizeCarePlanPrompt(state, log);
    
    // Extract care plan from the metadata of the last event
    const lastEvent = log[log.length - 1];
    const responseText = lastEvent?.meta?.rep || "{}";
    
    try {
      // First try direct JSON parsing
      let carePlan;
      try {
        carePlan = JSON.parse(responseText);
      } catch (parseError: unknown) {
        console.log("Initial JSON parsing failed, attempting to extract JSON from response...");
        
        // Try to extract JSON from the response if there's surrounding text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            carePlan = JSON.parse(jsonMatch[0]);
            console.log("Successfully extracted JSON from response");
          } catch (extractError: unknown) {
            if (extractError instanceof Error) {
              throw new Error("Could not parse extracted JSON: " + extractError.message);
            } else {
              throw new Error("Could not parse extracted JSON: Unknown error");
            }
          }
        } else {
          // Fallback to a basic structure if no JSON can be extracted
          console.log("No valid JSON found in response, using fallback structure");
          carePlan = {
            clinicalRecommendations: ["Follow surgeon's post-operative protocol"],
            homeServices: ["Physical therapy evaluation"],
            followUpSchedule: "As recommended by the care team",
            safetyMeasures: ["Remove tripping hazards"],
            caregiverInstructions: "Help with daily activities as needed"
          };
        }
      }
      
      console.log("Care Plan Created:");
      console.log(`- Clinical Recommendations: ${carePlan.clinicalRecommendations?.length || 0} items`);
      console.log(`- Home Services: ${carePlan.homeServices?.length || 0} services`);
      console.log(`- Follow-up: ${carePlan.followUpSchedule || "Not specified"}`);
      console.log(`- Safety Measures: ${carePlan.safetyMeasures?.length || 0} measures`);
      
      // Update the state with the care plan
      return await Fx.callTool<CarePlanState>("createCarePlan", [
        carePlan.clinicalRecommendations || [],
        carePlan.homeServices || [],
        carePlan.followUpSchedule || "",
        carePlan.safetyMeasures || [],
        carePlan.caregiverInstructions || ""
      ])(state, log);
    } catch (err) {
      console.error("Error parsing care plan:", err);
      // Return original state if we can't parse the care plan
      return state;
    }
  })
);

//-----------------------------------------------------------------------
// 5. Agent wrapper  ─────────────────────────────────────────────────────
export const carePlanAgent = Fx.agent<CarePlanState>(
  "CarePlanAgent",
  developCarePlan
);

//-----------------------------------------------------------------------
// 6. Run demo if executed directly  ────────────────────────────────────
if (require.main === module) {
  // Create a clean ledger for this run
  const fs = require('fs');
  const path = require('path');
  
  const ledgerDir = path.resolve("ledgers");
  const ledgerPath = path.resolve(ledgerDir, "careplan-ledger.jsonl");
  
  // Ensure directory exists
  if (!fs.existsSync(ledgerDir)) {
    fs.mkdirSync(ledgerDir, { recursive: true });
  }
  
  // Start with a fresh ledger file
  if (fs.existsSync(ledgerPath)) {
    fs.writeFileSync(ledgerPath, '');
  }
  
  // Sample patient case
  const seed: CarePlanState = {
    rootId: "root",
    iteration: 0,
    patientInfo: {
      name: "Mrs. Elaine Carter",
      age: 62,
      condition: "Recovering from total left hip replacement (5 days post-op)",
      medicalHistory: "Osteoarthritis, mild hypertension, controlled with medication",
      homeEnvironment: "Two-story home with bedroom on second floor, lives with husband who works part-time, son visits weekly"
    },
    teamMembers: {},
    finalCarePlan: {
      clinicalRecommendations: [],
      homeServices: [],
      followUpSchedule: "To be determined",
      safetyMeasures: [],
      caregiverInstructions: "Pending team assessment"
    }
  };
  
  // Add team members with their roles
  const withTeamMembers = Fx.sequence(
    Fx.callTool<CarePlanState>("addTeamMember", [
      "Dr. Wilson",
      "Orthopedic Surgeon",
      "You performed Mrs. Carter's hip replacement surgery. Offer clinical insights on recovery trajectory, highlight any red flags, and ensure physical milestones are on track."
    ]),
    Fx.callTool<CarePlanState>("addTeamMember", [
      "Sarah",
      "Care Manager",
      "You are a care management specialist assigned to Mrs. Carter. Evaluate discharge readiness, ensure safe transitions, and recommend support services based on her environment and needs."
    ]),
    Fx.callTool<CarePlanState>("addTeamMember", [
      "Michael",
      "Son / Family Caregiver",
      "You are Mrs. Carter's son who visits weekly. Express family concerns, ask questions about her safety and comfort, and advocate for what would help most during recovery at home."
    ])
  );
  
  // Minimal logging
  Fx.debug((ev, _) => {
    if (ev.name.startsWith('start:') || ev.name.startsWith('stop:')) {
      console.log(`${ev.name}`);
    }
  });

  // Run the agent
  Fx.spawn(Fx.sequence(withTeamMembers, carePlanAgent), seed)
    .then(final => {
      console.log("\n=== Complete Care Plan ===");
      if (final.finalCarePlan) {
        const plan = final.finalCarePlan;
        
        console.log("\nClinical Recommendations:");
        plan.clinicalRecommendations.forEach((rec, i) => console.log(`${i+1}. ${rec}`));
        
        console.log("\nHome Services:");
        plan.homeServices.forEach((service, i) => console.log(`${i+1}. ${service}`));
        
        console.log("\nFollow-Up Schedule:");
        console.log(plan.followUpSchedule);
        
        console.log("\nSafety Measures:");
        plan.safetyMeasures.forEach((measure, i) => console.log(`${i+1}. ${measure}`));
        
        console.log("\nCaregiver Instructions:");
        console.log(plan.caregiverInstructions);
      } else {
        console.log("No care plan was created.");
      }
    })
    .catch(err => {
      console.error("\nERROR in care plan agent execution:");
      console.error(err);
      process.exitCode = 1;
    });
} 