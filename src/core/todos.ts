import * as fs from 'fs/promises';
import { DebtItem, BlameEntry } from '../types.js';
import { getBlame } from './gitBlame.js';
import { createHash } from 'crypto';

const TODO_PATTERNS = ['TODO', 'FIXME', 'HACK', 'XXX', 'TEMP'];

export async function analyzeTodos(
  filePath: string,
  commitSha: string,
  patterns: string[] = TODO_PATTERNS
): Promise<DebtItem[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const items: DebtItem[] = [];
    
    const blameEntries = await getBlame(filePath, commitSha);
    const blameMap = new Map<number, BlameEntry>();
    for (const entry of blameEntries) {
      blameMap.set(entry.line, entry);
    }
    
    const regex = new RegExp(`\\b(${patterns.join('|')})\\b`, 'gi');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = regex.exec(line);
      
      if (match) {
        const lineNumber = i + 1;
        const blame = blameMap.get(lineNumber);
        
        const ageInDays = blame 
          ? Math.floor((Date.now() - blame.timestamp) / (1000 * 60 * 60 * 24))
          : 0;
        
        const severity = calculateTodoSeverity(ageInDays);
        
        const id = createHash('md5')
          .update(`${filePath}:${lineNumber}:todo`)
          .digest('hex');
        
        items.push({
          id,
          kind: 'todo',
          severity,
          file: filePath,
          line: lineNumber,
          message: line.trim(),
          author: blame?.author,
          ageInDays,
          lastCommit: blame?.commitHash
        });
      }
    }
    
    return items;
  } catch (error) {
    console.error(`Failed to analyze TODOs in ${filePath}:`, error);
    return [];
  }
}

function calculateTodoSeverity(ageInDays: number): 'critical' | 'high' | 'medium' | 'low' {
  if (ageInDays > 365) return 'critical';
  if (ageInDays > 180) return 'high';
  if (ageInDays > 30) return 'medium';
  return 'low';
}
