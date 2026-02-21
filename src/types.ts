export type DebtKind = 'todo' | 'complexity' | 'dep' | 'stale';
export type DebtSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface DebtItem {
  id: string;
  kind: DebtKind;
  severity: DebtSeverity;
  file: string;
  line?: number;
  message: string;
  author?: string;
  ageInDays?: number;
  lastCommit?: string;
}

export interface HotFile {
  file: string;
  score: number;
  importCount: number;
  debtItems: DebtItem[];
}

export interface DebtMap {
  items: DebtItem[];
  scannedAt: number;
  commitSha: string;
  stats: {
    totalDebt: number;
    byKind: Record<DebtKind, number>;
    bySeverity: Record<DebtSeverity, number>;
    hotFiles: HotFile[];
  };
}

export interface BlameEntry {
  line: number;
  author: string;
  timestamp: number;
  commitHash: string;
}

export interface ScanProgress {
  total: number;
  current: number;
  currentFile: string;
}

export interface Config {
  staleDaysThreshold: number;
  staleImportThreshold: number;
  complexityThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  todoPatterns: string[];
  excludeGlobs: string[];
  scanOnSave: boolean;
  showInlineDecorations: boolean;
  maxFilesToScan: number;
}
