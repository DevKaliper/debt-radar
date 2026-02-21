import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DebtItem } from '../types.js';
import { createHash } from 'crypto';

const execPromise = promisify(exec);

interface NpmAuditResult {
  vulnerabilities?: Record<string, {
    severity: string;
    name: string;
    via: Array<{ title: string }>;
  }>;
}

export async function analyzeDependencies(workspaceRoot: string): Promise<DebtItem[]> {
  try {
    const packageJsonPath = `${workspaceRoot}/package.json`;
    
    try {
      await fs.access(packageJsonPath);
    } catch {
      return [];
    }
    
    const items: DebtItem[] = [];
    
    try {
      const { stdout } = await execPromise('npm audit --json', {
        cwd: workspaceRoot,
        timeout: 10000
      });
      
      const auditResult: NpmAuditResult = JSON.parse(stdout);
      
      if (auditResult.vulnerabilities) {
        for (const [pkg, vuln] of Object.entries(auditResult.vulnerabilities)) {
          const severity = mapNpmSeverity(vuln.severity);
          const title = vuln.via[0]?.title || 'Vulnerability detected';
          
          const id = createHash('md5')
            .update(`dep:${pkg}:${title}`)
            .digest('hex');
          
          items.push({
            id,
            kind: 'dep',
            severity,
            file: 'package.json',
            message: `${pkg}: ${title}`,
          });
        }
      }
    } catch (error) {
      console.error('npm audit failed:', error);
    }
    
    return items;
  } catch (error) {
    console.error('Failed to analyze dependencies:', error);
    return [];
  }
}

function mapNpmSeverity(npmSeverity: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (npmSeverity.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'moderate': return 'medium';
    case 'low': return 'low';
    default: return 'low';
  }
}
