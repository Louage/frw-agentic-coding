// src/claudePlugin/types.ts — must not import "vscode" (WI-5a, PROJECT_BRIEF.md §14.4).
//
// Shared types for the Claude Code plugin emitter. Everything under
// src/claudePlugin/ except registration.ts and emitCli.ts must stay import-clean
// of "vscode" so it can be covered by `node --test` (AGENTS.md testing boundary).

/** Repo-relative POSIX path, e.g. "assets/generated/aldc-community/agents/phil.agent.md". */
export type RelPath = string;

export interface CopilotHandoff {
  label: string;
  agent: string;
  prompt?: string;
  send?: boolean;
}

export interface CopilotAgentFrontmatter {
  name: string; // "Phil, AL Developer" | "AL Planning Subagent"
  description?: string;
  tools?: string[];
  model?: string; // "Claude Sonnet 4.6 (copilot)"
  "argument-hint"?: string;
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
  "reasoning-effort"?: string;
  handoffs?: CopilotHandoff[];
  agents?: string[]; // subagent allowlist by display name (Malcolm)
  [extensionOnlyKey: string]: unknown; // stripped (#15)
}

export interface CopilotAgentDoc {
  sourcePath: RelPath;
  frontmatter: CopilotAgentFrontmatter;
  body: string;
}

export type ClaudeModelAlias = "sonnet" | "opus" | "haiku";
export type ClaudeToolName =
  | "Read"
  | "Grep"
  | "Glob"
  | "Edit"
  | "Write"
  | "Bash"
  | "PowerShell"
  | "WebFetch"
  | "WebSearch"
  | "Agent"
  | "Skill"
  | "TodoWrite";

/**
 * Deviation from the literal §14.4 contract shape (flagged for the Producer): `effort` was
 * added here. A11 requires `reasoning-effort` → `effort` on the emitted agent, but the
 * `frontmatter` shape quoted in §14.4 only lists `name/description/tools/model`. Without this
 * field there would be nowhere to carry the mapped value through to the A12 renderer.
 */
export interface ClaudeAgentFrontmatter {
  name: string;
  description: string;
  tools?: ClaudeToolName[];
  model?: ClaudeModelAlias;
  effort?: string;
}

export interface ClaudeAgentDoc {
  id: string; // "phil" → invoked as "acdc:phil"
  fileName: string; // "phil.md"
  frontmatter: ClaudeAgentFrontmatter;
  body: string;
}

export interface ClaudeCommandFrontmatter {
  description: string;
  "argument-hint"?: string;
  model?: ClaudeModelAlias;
}

export interface ClaudeCommandDoc {
  id: string; // "al-spec-create"
  fileName: string; // "al-spec-create.md"
  frontmatter: ClaudeCommandFrontmatter;
  body: string;
}

export interface SkillSource {
  dir: RelPath; // folder containing SKILL.md
  skillMd: string;
  supportingFiles: ReadonlyMap<RelPath, string | Uint8Array>; // relative to `dir`
}

export interface ClaudeSkillDoc {
  id: string; // "skill-api" | "al-performance-review"
  skillMd: string; // rendered; frontmatter name === id
  supportingFiles: ReadonlyMap<RelPath, string | Uint8Array>; // copied verbatim
}

export type EmitCode =
  | "tool-dropped"
  | "model-unmapped"
  | "key-stripped"
  | "handoff-target-unknown"
  | "duplicate-agent-id"
  | "duplicate-command-id"
  | "duplicate-skill-id"
  | "missing-source"
  | "unparseable-frontmatter"
  | "consumption-note-missing";

export interface EmitDiagnostic {
  level: "info" | "warn" | "error";
  source: RelPath;
  code: EmitCode;
  message: string;
}

export interface PluginSurfaceInput {
  /** From package.json. */
  packageMeta: {
    name: string;
    displayName?: string;
    description?: string;
    publisher: string;
    license?: string;
    repositoryUrl?: string;
  };
  contributions: { agents: RelPath[]; prompts: RelPath[]; skills: RelPath[] }; // contributes.* paths, "./" stripped
  /** Every file the plan may read, keyed by RelPath. The CLI decodes text files as UTF-8. */
  files: ReadonlyMap<RelPath, string | Uint8Array>;
}

export interface PlannedFile {
  path: RelPath;
  content: string | Uint8Array;
} // text is always LF, UTF-8

export interface PluginFilePlan {
  /** Every file under the managed roots. The CLI deletes anything on disk under them that isn't listed. */
  files: PlannedFile[];
  managedRoots: readonly [".claude-plugin", "claude-plugin"];
  diagnostics: EmitDiagnostic[];
  counts: { agents: number; commands: number; skills: number };
}
