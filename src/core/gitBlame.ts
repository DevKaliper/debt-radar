import simpleGit, { SimpleGit } from 'simple-git';
import { BlameEntry } from '../types.js';

const blameCache = new Map<string, BlameEntry[]>();

export async function getBlame(filePath: string, commitSha: string): Promise<BlameEntry[]> {
  const cacheKey = `${filePath}:${commitSha}`;
  
  if (blameCache.has(cacheKey)) {
    return blameCache.get(cacheKey)!;
  }

  try {
    const git: SimpleGit = simpleGit();
    const result = await git.raw(['blame', '--porcelain', filePath]);
    
    const entries: BlameEntry[] = [];
    const lines = result.split('\n');
    
    let currentHash = '';
    let currentAuthor = '';
    let currentTimestamp = 0;
    let currentLine = 0;
    
    for (const line of lines) {
      if (line.match(/^[a-f0-9]{40}/)) {
        const parts = line.split(' ');
        currentHash = parts[0];
        currentLine = parseInt(parts[2], 10);
      } else if (line.startsWith('author ')) {
        currentAuthor = line.substring(7);
      } else if (line.startsWith('author-time ')) {
        currentTimestamp = parseInt(line.substring(12), 10) * 1000;
        
        if (currentHash && currentAuthor && currentTimestamp) {
          entries.push({
            line: currentLine,
            author: currentAuthor,
            timestamp: currentTimestamp,
            commitHash: currentHash
          });
        }
      }
    }
    
    blameCache.set(cacheKey, entries);
    return entries;
  } catch (error) {
    console.error(`Failed to get blame for ${filePath}:`, error);
    return [];
  }
}

export function clearBlameCache(): void {
  blameCache.clear();
}

export async function getCurrentCommitSha(): Promise<string> {
  try {
    const git: SimpleGit = simpleGit();
    const log = await git.log(['-1']);
    return log.latest?.hash || '';
  } catch (error) {
    console.error('Failed to get current commit SHA:', error);
    return '';
  }
}

export async function isGitRepository(): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit();
    await git.revparse(['--git-dir']);
    return true;
  } catch {
    return false;
  }
}
