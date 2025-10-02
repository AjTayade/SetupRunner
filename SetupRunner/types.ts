/**
 * @file types.ts
 * @description Defines the shared data structures (the "contracts") for the SetupRunner module.
 * This ensures all three parts (Auditor, Planner, Executor) communicate correctly.
 */

// Part 1 Input: The structure of one dependency in the .devsetup.json file
export interface DependencyRequirement {
  id: string;              // A machine-readable ID, e.g., "node"
  name: string;            // A human-friendly name, e.g., "Node.js"
  requiredVersion: string; // A semver range, e.g., "^18.17.0"
  
  // --- SECURITY CHANGE ---
  // Replaced 'checkCommand' with structured, safe properties.
  cliName: string;         // The command-line tool to run, e.g., "node"
  versionFlag: string;     // The flag to get the version, e.g., "-v" or "--version"
}

// Part 1 Output / Part 2 Input: The result of checking one dependency on the local system
export interface AuditResult {
  dependency: DependencyRequirement;
  isInstalled: boolean;
  installedVersion?: string; // The version found on the system
}

// Part 2 Output / Part 3 Input: A single step in the overall execution plan.
export interface ActionStep {
  dependency: DependencyRequirement;
  action: 'INSTALL' | 'REINSTALL' | 'ALREADY_MET';
  reason: string; // A human-readable explanation for the action.
}

// The complete, ordered list of actions to be taken.
export type ActionPlan = ActionStep[];
