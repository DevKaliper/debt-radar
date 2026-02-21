# Debt Radar — Copilot Instructions

## Project Overview

**Debt Radar** is a VSCode extension that builds a living map of technical debt inside the editor. Unlike linters that only do static analysis, Debt Radar crosses code metrics with git history to give each piece of debt **temporal context**: how old is it, who owns it, is it getting worse, and how critical is the file that carries it.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode) |
| Runtime | VSCode Extension API (v1.85+) |
| UI | VSCode Webview API + React 18 + Tailwind CSS (via CDN) |
| Git integration | `simple-git` npm package |
| Complexity analysis | `escomplex` / `ts-complexity` |
| Dependency scanning | `npm audit --json` + OSV API (https://osv.dev/v1) |
| Packaging | `vsce` CLI |
| Testing | Vitest + `@vscode/test-electron` |

---

## Repository Structure

```
debt-radar/
├── .github/
│   └── workflows/
│       ├── ci.yml              # lint + test on every PR
│       └── release.yml         # publish to Marketplace on tag
├── src/
│   ├── extension.ts            # activation point, registers commands & providers
│   ├── core/
│   │   ├── scanner.ts          # orchestrates all analyzers, returns DebtMap
│   │   ├── gitBlame.ts         # wraps simple-git, returns BlameEntry[]
│   │   ├── complexity.ts       # cyclomatic complexity per function
│   │   ├── todos.ts            # extracts TODOs/FIXMEs with line + author + age
│   │   ├── deps.ts             # reads package.json, runs npm audit, hits OSV API
│   │   └── staleness.ts        # finds files untouched > N days but heavily imported
│   ├── dashboard/
│   │   ├── DashboardPanel.ts   # VSCode WebviewPanel wrapper
│   │   ├── webview/
│   │   │   ├── index.html      # shell loaded into the panel
│   │   │   ├── App.tsx         # React root
│   │   │   ├── components/
│   │   │   │   ├── DebtHeatmap.tsx
│   │   │   │   ├── TodoList.tsx
│   │   │   │   ├── ComplexityChart.tsx
│   │   │   │   ├── DepsTable.tsx
│   │   │   │   └── StaleFiles.tsx
│   │   │   └── hooks/
│   │   │       └── useDebtData.ts
│   ├── decorators/
│   │   └── inlineDebt.ts       # gutter icons + hover tooltips in the editor
│   ├── diagnostics/
│   │   └── debtDiagnostics.ts  # VSCode DiagnosticsCollection integration
│   ├── cache/
│   │   └── debtCache.ts        # file-level cache keyed by git commit SHA
│   └── types.ts                # shared TypeScript interfaces
├── test/
│   ├── unit/
│   └── integration/
├── package.json                # extension manifest + contributes
├── tsconfig.json
├── esbuild.config.mjs          # bundles extension + webview separately
├── .vscodeignore
└── README.md
```

---

## Core Data Types

All analyzers must return data conforming to these interfaces (defined in `src/types.ts`). Never invent ad-hoc shapes.

```typescript
export interface DebtItem {
  id: string;                    // deterministic hash of file+line
  kind: 'todo' | 'complexity' | 'dep' | 'stale';
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;                  // workspace-relative path
  line?: number;
  message: string;
  // git context
  author?: string;
  ageInDays?: number;
  lastCommit?: string;
}

export interface DebtMap {
  items: DebtItem[];
  scannedAt: number;             // Date.now()
  commitSha: string;             // HEAD at scan time
  stats: {
    totalDebt: number;
    byKind: Record<DebtItem['kind'], number>;
    bySeverity: Record<DebtItem['severity'], number>;
    hotFiles: HotFile[];         // top 10 files by debt score
  };
}

export interface HotFile {
  file: string;
  score: number;                 // composite 0–100
  importCount: number;
  debtItems: DebtItem[];
}

export interface BlameEntry {
  line: number;
  author: string;
  timestamp: number;
  commitHash: string;
}
```

---

## Analyzer Rules

### `gitBlame.ts`
- Use `simple-git` with `blame` parsed via `--porcelain` format.
- Cache blame per file keyed by `(filePath, commitSha)`.
- Must handle binary files and new untracked files gracefully (return empty array, never throw).

### `todos.ts`
- Regex scan for `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP` (case-insensitive).
- Cross-reference each match with `BlameEntry` to attach `author` and `ageInDays`.
- Severity: age < 30d → low, 30–180d → medium, 180–365d → high, > 365d → critical.

### `complexity.ts`
- Parse TypeScript/JavaScript with the VSCode built-in TS language service or `@typescript-eslint/parser`.
- Compute cyclomatic complexity per function.
- Thresholds: < 5 → ok (skip), 5–9 → low, 10–14 → medium, 15–24 → high, ≥ 25 → critical.
- Attach git blame for the function's start line.

### `deps.ts`
- Read `package.json` from the workspace root.
- Run `npm audit --json` via Node `child_process` (non-blocking, 10s timeout).
- Also call `https://osv.dev/v1/query` for each dependency to get CVE count and CVSS score.
- Map CVSS: ≥ 9.0 → critical, 7.0–8.9 → high, 4.0–6.9 → medium, < 4.0 → low.

### `staleness.ts`
- Use `simple-git` log to find last-modified date per file.
- Build an import graph by scanning `import`/`require` statements with regex (fast path) or TS compiler API (accurate path).
- A file is "stale-critical" if: last touched > 365 days ago AND imported by ≥ 5 other files.
- Severity: untouched > 365d + imported by ≥ 10 → critical; > 180d + ≥ 5 → high; etc.

---

## Dashboard (Webview)

- The webview is a **separate esbuild bundle** (`webview.js`). Do not mix extension and webview code.
- Communication is strictly via `vscode.postMessage` / `window.addEventListener('message')`. Never expose the VSCode API object globally.
- The webview must work with **Content Security Policy** enabled. No inline scripts, no eval.
- Use `acquireVsCodeApi()` once and store the result; do not call it multiple times.
- All chart data is passed from the extension host to the webview as a single `DebtMap` JSON payload via a `debtRadar.update` message type.

```typescript
// Message protocol (both directions)
type ExtensionToWebview =
  | { type: 'debtRadar.update'; payload: DebtMap }
  | { type: 'debtRadar.scanning' }
  | { type: 'debtRadar.error'; message: string };

type WebviewToExtension =
  | { type: 'debtRadar.openFile'; file: string; line: number }
  | { type: 'debtRadar.rescan' }
  | { type: 'debtRadar.ignore'; itemId: string };
```

---

## Extension Commands

Register these in `package.json#contributes.commands` and implement in `extension.ts`:

| Command ID | Title | Description |
|---|---|---|
| `debtRadar.scan` | Debt Radar: Scan Workspace | Full scan, opens dashboard |
| `debtRadar.openDashboard` | Debt Radar: Open Dashboard | Opens panel without rescanning |
| `debtRadar.scanFile` | Debt Radar: Scan Current File | Quick scan of active editor |
| `debtRadar.clearIgnored` | Debt Radar: Clear Ignored Items | Resets ignored debt items |
| `debtRadar.exportReport` | Debt Radar: Export Report (JSON) | Writes `debt-report.json` |

---

## Configuration (`package.json#contributes.configuration`)

```json
{
  "debtRadar.staleDaysThreshold": 365,
  "debtRadar.staleImportThreshold": 5,
  "debtRadar.complexityThresholds": {
    "low": 5, "medium": 10, "high": 15, "critical": 25
  },
  "debtRadar.todoPatterns": ["TODO", "FIXME", "HACK", "XXX", "TEMP"],
  "debtRadar.excludeGlobs": ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  "debtRadar.scanOnSave": false,
  "debtRadar.showInlineDecorations": true,
  "debtRadar.maxFilesToScan": 5000
}
```

---

## Performance Rules

- All file I/O must be async (`fs/promises`, never sync).
- Git blame is the bottleneck — always check the cache before calling `simple-git`.
- The scanner must process files in parallel with a concurrency limit of **20** (use `p-limit`).
- Total scan time for a 1000-file repo must be < 30 seconds. Add timing logs with `vscode.window.withProgress`.
- Never block the extension host thread. Wrap CPU-intensive work (complexity parsing) in `setImmediate` batches.

---

## Error Handling

- Wrap every analyzer in a try/catch. A failing analyzer must not crash the scan — log the error and return an empty array.
- If `git` is not available or the workspace is not a git repo, disable git-dependent features gracefully and show a one-time info notification.
- Webview errors must be caught, reported to the extension host via message, and displayed inline in the dashboard (never a blank panel).

---

## Testing

- Unit tests go in `test/unit/` and run with Vitest (no VSCode runtime needed).
- Integration tests go in `test/integration/` and use `@vscode/test-electron` with a fixture workspace in `test/fixtures/`.
- Every analyzer must have unit tests with at least one happy path, one edge case (empty file, binary file, no git), and one error case.
- Target: **≥ 80% line coverage** on `src/core/`.

---

## Publishing Checklist

Before running `vsce publish`:

1. `package.json` has `publisher`, `icon`, `categories`, `keywords`, `repository`, `engines.vscode`.
2. `README.md` has screenshots of the dashboard, feature list, and configuration table.
3. `CHANGELOG.md` follows Keep a Changelog format.
4. `.vscodeignore` excludes `src/`, `test/`, `node_modules/`, `esbuild.config.mjs`.
5. CI passes on `main`.
6. Version bumped with `vsce version patch|minor|major`.

---

## Code Style

- TypeScript strict mode (`"strict": true` in tsconfig).
- No `any` — use `unknown` and narrow with type guards.
- Prefer `const` over `let`; never `var`.
- Pure functions for all analyzers — no side effects, return data, let the caller decide what to do with it.
- Use named exports, not default exports (except React components in the webview).
- File names: `camelCase.ts` for modules, `PascalCase.tsx` for React components.
- All user-facing strings go through `vscode.l10n.t()` for future i18n.