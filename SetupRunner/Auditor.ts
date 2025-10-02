/**
 * @file auditor.ts
 * @description Part 1: The "Auditor" (Refactored with Automated Installer).
 * Responsibilities:
 * 1. Performs a pre-flight check for required package managers.
 * 2. AUTOMATICALLY installs the package manager (Homebrew on macOS) if missing, using the terminal for security.
 * 3. Reads a .devsetup.json file.
 * 4. Runs secure, non-destructive system checks.
 * 5. Returns a raw report of what was found.
 */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import * as semver from 'semver';
import { DependencyRequirement, AuditResult } from './types'; // Assumes the secure types.ts is used

interface DevSetupConfig {
  dependencies: DependencyRequirement[];
}

export async function runAudit(outputChannel: vscode.OutputChannel): Promise<AuditResult[] | null> {
  outputChannel.appendLine('[Auditor] Starting system audit...');

  try {
    await ensurePackageManager(outputChannel);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Setup cannot continue: ${error.message}`);
    outputChannel.appendLine(`[Auditor] FATAL: ${error.message}`);
    return null;
  }

  const config = await readConfigFile(outputChannel);
  if (!config || !config.dependencies || config.dependencies.length === 0) {
    outputChannel.appendLine('[Auditor] No dependencies found in config. Audit finished.');
    return [];
  }

  outputChannel.appendLine(`[Auditor] Found ${config.dependencies.length} dependencies to check.`);
  const auditPromises = config.dependencies.map(dep => checkSingleDependency(dep));
  const results = await Promise.all(auditPromises);
  outputChannel.appendLine('[Auditor] System audit complete.');
  return results;
}

// --- NEW: Automated Package Manager Installation ---

async function ensurePackageManager(outputChannel: vscode.OutputChannel): Promise<void> {
  outputChannel.appendLine(`[Auditor] Performing pre-flight check for OS: ${process.platform}`);
  switch (process.platform) {
    case 'darwin': // macOS
      await checkAndInstallHomebrew(outputChannel);
      break;
    case 'win32': // Windows
      await checkWinget(outputChannel);
      break;
    case 'linux':
      await detectLinuxDistribution(outputChannel);
      break;
    default:
      throw new Error(`Unsupported operating system: ${process.platform}`);
  }
}

async function checkAndInstallHomebrew(outputChannel: vscode.OutputChannel): Promise<void> {
  try {
    await executeCommand('command -v brew');
    outputChannel.appendLine('[Auditor] Homebrew is installed.');
  } catch (error) {
    outputChannel.appendLine('[Auditor] Homebrew not found. Starting automatic installation...');
    vscode.window.showInformationMessage('Homebrew is not installed. The extension will now install it in the terminal.');

    const installCommand = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
    const terminal = vscode.window.createTerminal(`Dev Env Setup: Homebrew`);
    terminal.show();

    try {
      // CRITICAL: We run the command in the terminal and wait for it to finish.
      // The user will be prompted for their password securely in this terminal.
      await runCommandInTerminalAndWait(terminal, installCommand, outputChannel);
      outputChannel.appendLine('[Auditor] Homebrew installation command finished.');
    } catch (installError: any) {
        throw new Error(`Homebrew installation failed. ${installError.message}`);
    }

    // Final verification
    try {
      await executeCommand('command -v brew');
      outputChannel.appendLine('[Auditor] Homebrew installation verified successfully.');
      vscode.window.showInformationMessage('Homebrew has been successfully installed!');
    } catch (verifyError) {
      throw new Error('Homebrew installation could not be verified. Please check the terminal for errors.');
    }
  }
}

async function checkWinget(outputChannel: vscode.OutputChannel): Promise<void> {
    try {
        await executeCommand('winget --version');
        outputChannel.appendLine('[Auditor] Winget is installed.');
    } catch (error) {
        outputChannel.appendLine('[Auditor] Winget not found. Prompting user...');
        
        const openStore = 'Open Microsoft Store';
        const response = await vscode.window.showErrorMessage(
            'Windows Package Manager (winget) is not installed, but it is required for this extension to work.',
            { 
                modal: true,
                detail: 'Please install the official "App Installer" from the Microsoft Store and then run the setup command again.' 
            },
            openStore
        );

        if (response === openStore) {
            // This URI opens the Microsoft Store page for the App Installer, which provides winget.
            const storeUri = vscode.Uri.parse('ms-windows-store://pdp/?productid=9NBLGGH4NNS1');
            await vscode.env.openExternal(storeUri);
            // We still throw an error to halt execution, as the user must install it manually.
            throw new Error('Opened Microsoft Store. Please install "App Installer" and re-run the setup.');
        } else {
            // This block runs if the user closes the dialog without clicking the button.
            throw new Error('User cancelled setup. Winget installation is required.');
        }
    }
}

async function detectLinuxDistribution(outputChannel: vscode.OutputChannel): Promise<void> {
    // No installation needed here. The Executor will use 'sudo' in the terminal for individual packages.
    try {
        const osRelease = await fs.readFile('/etc/os-release', 'utf-8');
        const idLine = osRelease.split('\n').find(line => line.startsWith('ID='));
        const distro = idLine ? idLine.split('=')[1].replace(/"/g, '') : 'unknown';
        const supportedDistros = ['ubuntu', 'debian', 'fedora', 'centos', 'rhel', 'arch', 'suse', 'opensuse'];
        if (supportedDistros.includes(distro)) {
            outputChannel.appendLine(`[Auditor] Detected supported Linux distribution: ${distro}`);
        } else {
            outputChannel.appendLine(`[Auditor] WARNING: Detected unsupported Linux distribution: ${distro}.`);
        }
    } catch (error) {
        throw new Error('Could not detect Linux distribution.');
    }
}


// --- NEW: Robust Terminal Command Execution Utility ---

function runCommandInTerminalAndWait(terminal: vscode.Terminal, command: string, outputChannel: vscode.OutputChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    outputChannel.appendLine(`[Auditor] > Sending to terminal: ${command}`);
    const commandId = `COMMAND_EXIT_CODE_${Date.now()}`;
    const exitCodeCommand = `echo ${commandId}:$?`;

    const listener = vscode.window.onDidWriteTerminalData((e: vscode.TerminalDataWriteEvent) => {
      if (e.terminal === terminal && e.data.includes(commandId)) {
        const exitCodeMatch = e.data.match(new RegExp(`${commandId}:(\\d+)`));
        const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : -1;
        
        // Clean up the listener immediately
        listener.dispose();

        if (exitCode === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${exitCode}. Please check the terminal for details.`));
        }
      }
    });
    
    // Send the actual command followed by our exit code checker
    terminal.sendText(`${command}; ${exitCodeCommand}`);
  });
}

// --- Unchanged Helper and Security Functions ---

function executeCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(command, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || 'Command failed')); } else { resolve(stdout); }
    });
  });
}

function checkSingleDependency(dependency: DependencyRequirement): Promise<AuditResult> {
  const command = `${dependency.cliName} ${dependency.versionFlag}`;
  return new Promise((resolve) => {
    cp.exec(command, (error, stdout) => {
      if (error) { resolve({ dependency, isInstalled: false }); return; }
      const installedVersion = semver.coerce(stdout.trim())?.version;
      resolve({ dependency, isInstalled: true, installedVersion });
    });
  });
}

async function readConfigFile(outputChannel: vscode.OutputChannel): Promise<DevSetupConfig | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('Cannot run audit: No workspace is currently open.');
    return null;
  }
  for (const folder of workspaceFolders) {
    const configPath = path.join(folder.uri.fsPath, '.devsetup.json');
    try {
      const fileContent = await fs.readFile(configPath, 'utf-8');
      outputChannel.appendLine(`[Auditor] Found config file at: ${configPath}`);
      return JSON.parse(fileContent) as DevSetupConfig;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        outputChannel.appendLine(`[Auditor] ERROR: Could not parse .devsetup.json in ${folder.uri.fsPath}.`);
      }
    }
  }
  vscode.window.showErrorMessage('No .devsetup.json file found in your workspace.');
  return null;
}


