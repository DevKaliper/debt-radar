import * as vscode from 'vscode';
import { scanWorkspace } from './core/scanner.js';
import { Config, DebtMap } from './types.js';
import * as path from 'path';

let currentDebtMap: DebtMap | null = null;
let outputChannel: vscode.OutputChannel;
let diagnosticsCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Debt Radar');
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('debtRadar');
  
  context.subscriptions.push(outputChannel);
  context.subscriptions.push(diagnosticsCollection);
  
  const scanCommand = vscode.commands.registerCommand('debtRadar.scan', async () => {
    await performScan(context);
  });
  
  const openDashboardCommand = vscode.commands.registerCommand('debtRadar.openDashboard', async () => {
    if (!currentDebtMap) {
      vscode.window.showInformationMessage('No scan data available. Running scan first...');
      await performScan(context);
    }
    outputChannel.appendLine('Dashboard feature coming soon');
  });
  
  const scanFileCommand = vscode.commands.registerCommand('debtRadar.scanFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active file to scan');
      return;
    }
    
    outputChannel.appendLine(`Quick scan of ${editor.document.fileName}`);
    vscode.window.showInformationMessage('File scan feature coming soon');
  });
  
  const clearIgnoredCommand = vscode.commands.registerCommand('debtRadar.clearIgnored', () => {
    context.globalState.update('debtRadar.ignoredItems', []);
    vscode.window.showInformationMessage('Cleared ignored items');
  });
  
  const exportReportCommand = vscode.commands.registerCommand('debtRadar.exportReport', async () => {
    if (!currentDebtMap) {
      vscode.window.showWarningMessage('No scan data available. Run a scan first.');
      return;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) return;
    
    const reportPath = path.join(workspaceRoot, 'debt-report.json');
    const uri = vscode.Uri.file(reportPath);
    
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(currentDebtMap, null, 2)));
    
    vscode.window.showInformationMessage(`Report exported to ${reportPath}`);
  });
  
  context.subscriptions.push(
    scanCommand,
    openDashboardCommand,
    scanFileCommand,
    clearIgnoredCommand,
    exportReportCommand
  );
  
  outputChannel.appendLine('Debt Radar activated');
}

async function performScan(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }
  
  const config = getConfig();
  
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Debt Radar: Scanning workspace',
      cancellable: false
    },
    async (progress) => {
      try {
        progress.report({ message: 'Starting scan...' });
        
        const debtMap = await scanWorkspace(
          workspaceRoot,
          config,
          (current, total, file) => {
            const percentage = Math.floor((current / total) * 100);
            progress.report({
              message: `${percentage}% - ${path.basename(file)}`,
              increment: 1
            });
          }
        );
        
        currentDebtMap = debtMap;
        
        updateDiagnostics(debtMap);
        
        const stats = debtMap.stats;
        outputChannel.appendLine(`\n=== Debt Radar Scan Complete ===`);
        outputChannel.appendLine(`Scanned at: ${new Date(debtMap.scannedAt).toLocaleString()}`);
        outputChannel.appendLine(`Commit: ${debtMap.commitSha}`);
        outputChannel.appendLine(`Total debt items: ${stats.totalDebt}`);
        outputChannel.appendLine(`\nBy Kind:`);
        outputChannel.appendLine(`  TODOs: ${stats.byKind.todo}`);
        outputChannel.appendLine(`  Complexity: ${stats.byKind.complexity}`);
        outputChannel.appendLine(`  Dependencies: ${stats.byKind.dep}`);
        outputChannel.appendLine(`  Stale Files: ${stats.byKind.stale}`);
        outputChannel.appendLine(`\nBy Severity:`);
        outputChannel.appendLine(`  Critical: ${stats.bySeverity.critical}`);
        outputChannel.appendLine(`  High: ${stats.bySeverity.high}`);
        outputChannel.appendLine(`  Medium: ${stats.bySeverity.medium}`);
        outputChannel.appendLine(`  Low: ${stats.bySeverity.low}`);
        outputChannel.appendLine(`\nHot Files (top 10):`);
        for (const hotFile of stats.hotFiles) {
          outputChannel.appendLine(`  ${hotFile.file} (score: ${hotFile.score})`);
        }
        
        outputChannel.show();
        
        vscode.window.showInformationMessage(
          `Debt Radar: Found ${stats.totalDebt} debt items (${stats.bySeverity.critical} critical)`
        );
      } catch (error) {
        outputChannel.appendLine(`Error during scan: ${error}`);
        vscode.window.showErrorMessage(`Debt Radar scan failed: ${error}`);
      }
    }
  );
}

function updateDiagnostics(debtMap: DebtMap) {
  diagnosticsCollection.clear();
  
  const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();
  
  for (const item of debtMap.items) {
    if (!item.line) continue;
    
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) continue;
    
    const filePath = path.join(workspaceRoot, item.file);
    
    if (!diagnosticsByFile.has(filePath)) {
      diagnosticsByFile.set(filePath, []);
    }
    
    const severity = {
      critical: vscode.DiagnosticSeverity.Error,
      high: vscode.DiagnosticSeverity.Error,
      medium: vscode.DiagnosticSeverity.Warning,
      low: vscode.DiagnosticSeverity.Information
    }[item.severity];
    
    const range = new vscode.Range(
      item.line - 1,
      0,
      item.line - 1,
      1000
    );
    
    const diagnostic = new vscode.Diagnostic(range, item.message, severity);
    diagnostic.source = 'Debt Radar';
    diagnostic.code = item.kind;
    
    diagnosticsByFile.get(filePath)!.push(diagnostic);
  }
  
  for (const [filePath, diagnostics] of diagnosticsByFile) {
    diagnosticsCollection.set(vscode.Uri.file(filePath), diagnostics);
  }
}

function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('debtRadar');
  
  return {
    staleDaysThreshold: config.get('staleDaysThreshold', 365),
    staleImportThreshold: config.get('staleImportThreshold', 5),
    complexityThresholds: config.get('complexityThresholds', {
      low: 5,
      medium: 10,
      high: 15,
      critical: 25
    }),
    todoPatterns: config.get('todoPatterns', ['TODO', 'FIXME', 'HACK', 'XXX', 'TEMP']),
    excludeGlobs: config.get('excludeGlobs', ['**/node_modules/**', '**/dist/**', '**/.git/**']),
    scanOnSave: config.get('scanOnSave', false),
    showInlineDecorations: config.get('showInlineDecorations', true),
    maxFilesToScan: config.get('maxFilesToScan', 5000)
  };
}

export function deactivate() {
  diagnosticsCollection.dispose();
  outputChannel.dispose();
}
