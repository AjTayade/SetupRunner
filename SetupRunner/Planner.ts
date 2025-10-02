/**
 * @file planner.ts
 * @description Part 2: The "Planner".
 * Responsibilities:
 * 1. Takes the raw audit results from the Auditor.
 * 2. Compares the required version with the installed version using semantic versioning.
 * 3. Creates a structured "Action Plan" that the Executor will use.
 */
import * as semver from 'semver';
import { AuditResult, ActionPlan, ActionStep } from './types';

/**
 * The main entry point for the Planner.
 * Creates an ActionPlan based on the results of the system audit.
 * @param auditResults The array of AuditResult objects from the Auditor (Part 1).
 * @returns An ActionPlan detailing exactly what needs to be done.
 */
export function createActionPlan(auditResults: AuditResult[]): ActionPlan {
  const plan: ActionPlan = [];

  for (const result of auditResults) {
    plan.push(determineAction(result));
  }

  return plan;
}

/**
 * Determines the necessary action for a single dependency based on its audit result.
 * This is the core logic of the Planner.
 * @param result The audit result for a single dependency.
 * @returns An ActionStep object for the plan.
 */
function determineAction(result: AuditResult): ActionStep {
  const { dependency, isInstalled, installedVersion } = result;

  if (!isInstalled) {
    return {
      dependency,
      action: 'INSTALL',
      reason: `${dependency.name} is not installed.`,
    };
  }

  if (installedVersion && semver.satisfies(installedVersion, dependency.requiredVersion)) {
    return {
      dependency,
      action: 'ALREADY_MET',
      reason: `${dependency.name} is installed at a compatible version (${installedVersion}).`,
    };
  }

  return {
    dependency,
    action: 'REINSTALL',
    reason: `${dependency.name} is installed at an incompatible version (${installedVersion || 'unknown'}). Version ${dependency.requiredVersion} is required.`,
  };
}