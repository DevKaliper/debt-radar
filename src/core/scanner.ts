import * as vscode from 'vscode';
import pLimit from 'p-limit';
import { DebtItem, DebtMap, Config, HotFile } from '../types.js';
import { getCurrentCommitSha, isGitRepository } from './gitBlame.js';
import { analyzeTodos } from './todos.js';
import { analyzeComplexity } from './complexity.js';
import { analyzeDependencies } from './deps.js';
import { analyzeStaleness } from './staleness.js';

const limit = pLimit(20);

export async function scanWorkspace(
  workspaceRoot: string,
  config: Config,
  progressCallback?: (current: number, total: number, file: string) => void
): Promise<DebtMap> {
  const isGit = await isGitRepository();
  if (!isGit) {
    vscode.window.showInformationMessage(
      'Debt Radar: Git repository not detected. Some features will be disabled.'
    );
  }
  
  const commitSha = isGit ? await getCurrentCommitSha() : '';
  
  const files = await findFilesToScan(workspaceRoot, config);
  
  if (files.length > config.maxFilesToScan) {
    files.splice(config.maxFilesToScan);
  }
  
  const allItems: DebtItem[] = [];
  let processed = 0;
  
  const scanPromises = files.map(file =>
    limit(async () => {
      const items: DebtItem[] = [];
      
      const todoItems = await analyzeTodos(file, commitSha, config.todoPatterns);
      items.push(...todoItems);
      
      const complexityItems = await analyzeComplexity(file, commitSha, config.complexityThresholds);
      items.push(...complexityItems);
      
      processed++;
      if (progressCallback) {
        progressCallback(processed, files.length, file);
      }
      
      return items;
    })
  );
  
  const results = await Promise.all(scanPromises);
  for (const items of results) {
    allItems.push(...items);
  }
  
  const depItems = await analyzeDependencies(workspaceRoot);
  allItems.push(...depItems);
  
  const staleItems = await analyzeStaleness(workspaceRoot, files, {
    staleDaysThreshold: config.staleDaysThreshold,
    staleImportThreshold: config.staleImportThreshold
  });
  allItems.push(...staleItems);
  
  const stats = calculateStats(allItems);
  
  return {
    items: allItems,
    scannedAt: Date.now(),
    commitSha,
    stats
  };
}

async function findFilesToScan(workspaceRoot: string, config: Config): Promise<string[]> {
  const files: string[] = [];
  
  const excludePatterns = config.excludeGlobs.map(glob => 
    new vscode.RelativePattern(workspaceRoot, glob)
  );
  
  const includePattern = new vscode.RelativePattern(workspaceRoot, '**/*.{ts,tsx,js,jsx,py,java,go,rs}');
  
  const uris = await vscode.workspace.findFiles(includePattern, `{${config.excludeGlobs.join(',')}}`);
  
  for (const uri of uris) {
    const relativePath = vscode.workspace.asRelativePath(uri);
    files.push(relativePath);
  }
  
  return files;
}

function calculateStats(items: DebtItem[]) {
  const byKind: Record<string, number> = {
    todo: 0,
    complexity: 0,
    dep: 0,
    stale: 0
  };
  
  const bySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };
  
  for (const item of items) {
    byKind[item.kind]++;
    bySeverity[item.severity]++;
  }
  
  const fileScores = new Map<string, { score: number; items: DebtItem[]; importCount: number }>();
  
  for (const item of items) {
    if (!fileScores.has(item.file)) {
      fileScores.set(item.file, { score: 0, items: [], importCount: 0 });
    }
    
    const entry = fileScores.get(item.file)!;
    entry.items.push(item);
    
    const severityScore = {
      critical: 25,
      high: 10,
      medium: 5,
      low: 2
    }[item.severity];
    
    entry.score += severityScore;
  }
  
  const hotFiles: HotFile[] = Array.from(fileScores.entries())
    .map(([file, data]) => ({
      file,
      score: Math.min(100, data.score),
      importCount: data.importCount,
      debtItems: data.items
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  
  return {
    totalDebt: items.length,
    byKind: byKind as any,
    bySeverity: bySeverity as any,
    hotFiles
  };
}
