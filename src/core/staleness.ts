import * as fs from 'fs/promises';
import simpleGit, { SimpleGit } from 'simple-git';
import { DebtItem } from '../types.js';
import { createHash } from 'crypto';

interface StaleConfig {
  staleDaysThreshold: number;
  staleImportThreshold: number;
}

export async function analyzeStaleness(
  workspaceRoot: string,
  files: string[],
  config: StaleConfig
): Promise<DebtItem[]> {
  try {
    const git: SimpleGit = simpleGit(workspaceRoot);
    const items: DebtItem[] = [];
    
    const fileAges = new Map<string, number>();
    
    for (const file of files) {
      try {
        const log = await git.log({ file, maxCount: 1 });
        if (log.latest) {
          const timestamp = new Date(log.latest.date).getTime();
          const ageInDays = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
          fileAges.set(file, ageInDays);
        }
      } catch {
        continue;
      }
    }
    
    const importGraph = await buildImportGraph(workspaceRoot, files);
    
    for (const [file, ageInDays] of fileAges) {
      if (ageInDays < config.staleDaysThreshold) {
        continue;
      }
      
      const importCount = importGraph.get(file) || 0;
      
      if (importCount < config.staleImportThreshold) {
        continue;
      }
      
      const severity = calculateStaleSeverity(ageInDays, importCount, config);
      
      const id = createHash('md5')
        .update(`${file}:stale`)
        .digest('hex');
      
      items.push({
        id,
        kind: 'stale',
        severity,
        file,
        message: `File untouched for ${ageInDays} days but imported by ${importCount} files`,
        ageInDays
      });
    }
    
    return items;
  } catch (error) {
    console.error('Failed to analyze staleness:', error);
    return [];
  }
}

async function buildImportGraph(workspaceRoot: string, files: string[]): Promise<Map<string, number>> {
  const importCounts = new Map<string, number>();
  
  for (const file of files) {
    if (!file.match(/\.(ts|tsx|js|jsx)$/)) {
      continue;
    }
    
    try {
      const fullPath = `${workspaceRoot}/${file}`;
      const content = await fs.readFile(fullPath, 'utf-8');
      
      const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        
        if (importPath.startsWith('.')) {
          const normalized = normalizeImportPath(file, importPath);
          importCounts.set(normalized, (importCounts.get(normalized) || 0) + 1);
        }
      }
    } catch {
      continue;
    }
  }
  
  return importCounts;
}

function normalizeImportPath(fromFile: string, importPath: string): string {
  const fromDir = fromFile.split('/').slice(0, -1).join('/');
  const parts = [...fromDir.split('/'), ...importPath.split('/')];
  
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      normalized.pop();
    } else if (part !== '.' && part !== '') {
      normalized.push(part);
    }
  }
  
  let result = normalized.join('/');
  
  if (!result.match(/\.(ts|tsx|js|jsx)$/)) {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      result = result + ext;
      break;
    }
  }
  
  return result;
}

function calculateStaleSeverity(
  ageInDays: number,
  importCount: number,
  config: StaleConfig
): 'critical' | 'high' | 'medium' | 'low' {
  if (ageInDays > 365 && importCount >= 10) return 'critical';
  if (ageInDays > 365 && importCount >= config.staleImportThreshold) return 'high';
  if (ageInDays > 180 && importCount >= config.staleImportThreshold) return 'high';
  if (ageInDays > 180) return 'medium';
  return 'medium';
}
