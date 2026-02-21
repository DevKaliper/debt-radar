import * as fs from 'fs/promises';
import { DebtItem, BlameEntry } from '../types.js';
import { getBlame } from './gitBlame.js';
import { createHash } from 'crypto';

interface ComplexityThresholds {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

const DEFAULT_THRESHOLDS: ComplexityThresholds = {
  low: 5,
  medium: 10,
  high: 15,
  critical: 25
};

export async function analyzeComplexity(
  filePath: string,
  commitSha: string,
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS
): Promise<DebtItem[]> {
  try {
    if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) {
      return [];
    }
    
    const content = await fs.readFile(filePath, 'utf-8');
    const functions = extractFunctions(content);
    
    const items: DebtItem[] = [];
    const blameEntries = await getBlame(filePath, commitSha);
    const blameMap = new Map<number, BlameEntry>();
    for (const entry of blameEntries) {
      blameMap.set(entry.line, entry);
    }
    
    for (const func of functions) {
      const complexity = calculateCyclomaticComplexity(func.body);
      
      if (complexity < thresholds.low) {
        continue;
      }
      
      const severity = calculateComplexitySeverity(complexity, thresholds);
      const blame = blameMap.get(func.line);
      
      const id = createHash('md5')
        .update(`${filePath}:${func.line}:complexity`)
        .digest('hex');
      
      items.push({
        id,
        kind: 'complexity',
        severity,
        file: filePath,
        line: func.line,
        message: `Function '${func.name}' has cyclomatic complexity of ${complexity}`,
        author: blame?.author,
        ageInDays: blame ? Math.floor((Date.now() - blame.timestamp) / (1000 * 60 * 60 * 24)) : undefined,
        lastCommit: blame?.commitHash
      });
    }
    
    return items;
  } catch (error) {
    console.error(`Failed to analyze complexity in ${filePath}:`, error);
    return [];
  }
}

interface FunctionInfo {
  name: string;
  line: number;
  body: string;
}

function extractFunctions(content: string): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const lines = content.split('\n');
  
  const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|(\w+)\s*\([^)]*\)\s*\{)/g;
  
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    const name = match[1] || match[2] || match[3] || 'anonymous';
    const lineNumber = content.substring(0, match.index).split('\n').length;
    
    const startIndex = match.index;
    const braceIndex = content.indexOf('{', startIndex);
    if (braceIndex === -1) continue;
    
    let braceCount = 1;
    let endIndex = braceIndex + 1;
    
    while (braceCount > 0 && endIndex < content.length) {
      if (content[endIndex] === '{') braceCount++;
      if (content[endIndex] === '}') braceCount--;
      endIndex++;
    }
    
    const body = content.substring(braceIndex, endIndex);
    
    functions.push({
      name,
      line: lineNumber,
      body
    });
  }
  
  return functions;
}

function calculateCyclomaticComplexity(code: string): number {
  let complexity = 1;
  
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\&\&/g,
    /\|\|/g,
    /\?/g
  ];
  
  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }
  
  return complexity;
}

function calculateComplexitySeverity(
  complexity: number,
  thresholds: ComplexityThresholds
): 'critical' | 'high' | 'medium' | 'low' {
  if (complexity >= thresholds.critical) return 'critical';
  if (complexity >= thresholds.high) return 'high';
  if (complexity >= thresholds.medium) return 'medium';
  return 'low';
}
