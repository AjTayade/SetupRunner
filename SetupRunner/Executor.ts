/**
 * @file executor.ts
 * @description Part 3: The "Executor" (Advanced).
 * This version includes logic to handle different Linux distributions and uses a
 * hybrid execution model for enhanced security and usability on Linux.
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import { ActionPlan, ActionStep, DependencyRequirement } from './types';
import { PACKAGE_NAMES } from './dependencyConfig';

// --- State variable to cache Linux package manager ---
let detectedPackageManager: 'apt' | 'dnf' | 'pacman' | 'unknown' | null = null;

export async function executePlan(plan: ActionPlan, outputChannel: vscode.OutputChannel): Promise<void> {
  outputChannel.appendLine(`[Executor] Starting execution of ${plan.length}-step plan.`);
  const isLinux = os.platform() === 'linux';
  let terminal: vscode.Terminal | undefined;

  if (isLinux) {
    terminal = vscode.window.createTerminal(`Dev Env Setup`);
    terminal.show();
    await detectLinuxPackageManager(outputChannel); // Detect the package manager once
  }

  for (const step of plan) {
    try {
      switch (step.action) {
        case 'INSTALL':
          await installDependency(step, outputChannel, terminal);
          break;
        case 'REINSTALL':
          await uninstallDependency(step, outputChannel, terminal);
          await installDependency(step, outputChannel, terminal);
          break;
        case 'ALREADY_MET':
          {
            const message = `[Executor] Skipping '${step.dependency.name}' - Requirement already met.`;
            outputChannel.appendLine(message);
            if (terminal) {
              terminal.sendText(`echo "[INFO] ${message}"`);
            }
            break;
          }
      }
    } catch (error) {
      const errorMsg = `[Executor] FAILED step for '${step.dependency.name}'. Check logs or terminal for details.`;
      outputChannel.appendLine(errorMsg);
      if (terminal) {
        terminal.sendText(`echo "\\n[ERROR] ${errorMsg}\\n"`);
      }
    }
  }

  outputChannel.appendLine('[Executor] Plan execution finished.');
  if (terminal) {
    terminal.sendText(`echo "\\n[SUCCESS] All setup tasks complete. You can now close this terminal."`);
  }
}

// --- Helper Functions for Linux Detection ---
async function detectLinuxPackageManager(outputChannel: vscode.OutputChannel): Promise<void> {
    if (detectedPackageManager) {
        return; // Don't detect more than once
    }

    outputChannel.appendLine('[Executor] Detecting Linux package manager...');
    const managers = ['apt', 'dnf', 'pacman'];
    for (const manager of managers) {
        try {
            // 'command -v' is a portable way to check if a command exists
            await runCommandSilently(`command -v ${manager}`, outputChannel);
            outputChannel.appendLine(`[Executor] Detected: ${manager}`);
            detectedPackageManager = manager as 'apt' | 'dnf' | 'pacman';
            return;
        } catch (error) {
            // Command not found, continue to the next one
        }
    }
    outputChannel.appendLine('[Executor] Could not detect a supported Linux package manager.');
    detectedPackageManager = 'unknown';
}


// --- HYBRID COMMAND EXECUTION ---
async function runCommand(command: string, outputChannel: vscode.OutputChannel, terminal?: vscode.Terminal): Promise<void> {
  if (terminal) {
    return runCommandInTerminal(command, terminal);
  } else {
    return runCommandSilently(command, outputChannel);
  }
}

function runCommandSilently(command: string, outputChannel: vscode.OutputChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    outputChannel.appendLine(`[Executor] > Running silently: ${command}`);
    const process = cp.exec(command, { timeout: 600000 }, (error) => { // 10-minute timeout
      if (error) {
        const errorMsg = error.killed ? `Command timed out after 10 minutes.` : error.message;
        reject(new Error(errorMsg));
      } else {
        resolve();
      }
    });
    process.stdout?.on('data', (data) => outputChannel.append(data.toString()));
    process.stderr?.on('data', (data) => outputChannel.append(data.toString()));
  });
}

function runCommandInTerminal(command: string, terminal: vscode.Terminal): Promise<void> {
  return new Promise((resolve, reject) => {
    const commandId = `COMMAND_EXIT_CODE_${Date.now()}`;
    const exitCodeCommand = `echo ${commandId}:$?`;

    // FIX 1: Using 'vscode.window' to access the correct API.
    // FIX 2: Explicitly typing 'e' as 'vscode.TerminalDataWriteEvent'.
    const listener = vscode.window.onDidWriteTerminalData((e: vscode.TerminalDataWriteEvent) => {
      if (e.terminal === terminal && e.data.includes(commandId)) {
        const exitCodeMatch = e.data.match(new RegExp(`${commandId}:(\\d+)`));
        const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : -1;
        listener.dispose();
        if (exitCode === 0) {
            resolve();
        } else {
            reject(new Error(`Command failed with exit code ${exitCode}.`));
        }
      }
    });
    terminal.sendText(`${command}; ${exitCodeCommand}`);
  });
}


// --- DYNAMIC COMMAND BUILDERS (NOW LINUX-AWARE) ---

function getInstallCommand(dependency: DependencyRequirement): string | null {
  const platform = os.platform();
  const packageName = getPackageNameForPlatform(dependency.id, platform);
  if (!packageName) { return null; }

  switch (platform) {
    case 'win32': return `winget install -e --id ${packageName}`;
    case 'darwin': return `brew install ${packageName}`;
    case 'linux':
        switch(detectedPackageManager) {
            case 'apt': return `sudo apt-get install -y ${packageName}`;
            case 'dnf': return `sudo dnf install -y ${packageName}`;
            case 'pacman': return `sudo pacman -S --noconfirm ${packageName}`;
            default: return null;
        }
    default: return null;
  }
}

function getUninstallCommand(dependency: DependencyRequirement): string | null {
  const platform = os.platform();
  const packageName = getPackageNameForPlatform(dependency.id, platform);
  if (!packageName) { return null; }

  switch (platform) {
    case 'win32': return `winget uninstall -e --id ${packageName}`;
    case 'darwin': return `brew uninstall ${packageName}`;
    case 'linux':
        switch(detectedPackageManager) {
            case 'apt': return `sudo apt-get remove -y ${packageName}`;
            case 'dnf': return `sudo dnf remove -y ${packageName}`;
            case 'pacman': return `sudo pacman -Rns --noconfirm ${packageName}`;
            default: return null;
        }
    default: return null;
  }
}

function getPackageNameForPlatform(id: string, platform: NodeJS.Platform): string | null {
    const platformSpecificNames = PACKAGE_NAMES[id as keyof typeof PACKAGE_NAMES];
    if (!platformSpecificNames) { return null; }

    const key = platform === 'linux' ? detectedPackageManager : platform;
    if (!key) { return null; }

    return platformSpecificNames[key as keyof typeof platformSpecificNames] || null;
}

// These helper functions remain unchanged
async function installDependency(step: ActionStep, outputChannel: vscode.OutputChannel, terminal?: vscode.Terminal): Promise<void> {
    const { dependency } = step;
    outputChannel.appendLine(`[Executor] Starting INSTALL for '${dependency.name}'...`);
    const command = getInstallCommand(dependency);
    if (!command) {
      const errorMsg = `[Executor] ERROR: No install command configured for '${dependency.name}' on this OS.`;
      vscode.window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
    await runCommand(command, outputChannel, terminal);
}
async function uninstallDependency(step: ActionStep, outputChannel: vscode.OutputChannel, terminal?: vscode.Terminal): Promise<void> {
    const { dependency } = step;
    outputChannel.appendLine(`[Executor] Starting UNINSTALL for '${dependency.name}'...`);
    const command = getUninstallCommand(dependency);
    if (!command) {
      const errorMsg = `[Executor] ERROR: No uninstall command configured for '${dependency.name}' on this OS.`;
      vscode.window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
    await runCommand(command, outputChannel, terminal);
}

