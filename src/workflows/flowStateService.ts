import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";

/**
 * A single completed step in the agent's flow history.
 */
export interface IFlowHistoryStep {
  label: string;
  /** Agent display name that owned this step when completed. */
  agentDisplayName?: string;
  /** Optional SKILL.md name that was applied at this step. */
  skill?: string;
  /** ISO timestamp for ordering / tooltips. */
  completedAt: string;
}

/**
 * The current active step (in progress) shown highlighted in the flow diagram.
 */
export interface IFlowActiveStep {
  label: string;
  /** Agent display name that owns the active step. */
  agentDisplayName?: string;
  skill?: string;
  startedAt: string;
}

/**
 * A step in the agent's planned flow — the roadmap of steps the agent is
 * expected to walk through. Rendered as dimmed placeholders in the sidebar so
 * the user can see the whole workflow up-front, with active/completed steps
 * highlighted as the agent progresses.
 */
export interface IFlowPlannedStep {
  label: string;
  /** Optional human-friendly summary shown as a tooltip. */
  description?: string;
  /**
   * How this planned entry should be rendered.
   * - `"step"` (default): a normal internal phase of the agent's own pipeline
   *   (parsed from `### Step N — <label>` headings).
   * - `"review"`: a review/critique loop with another agent (e.g. the
   *   `bcReviewSpecialist` declared in `agent-metadata.json`). The agent hands
   *   off, receives critique, and may iterate.
   * - `"handoff"`: an outgoing handoff option to another agent (parsed from
   *   the `handoffs:` frontmatter). Terminal — control transfers.
   */
  kind?: "step" | "review" | "handoff";
  /**
   * For `"review"` and `"handoff"` entries — the target agent's display name.
   * Used both as the visible label suffix and, together with
   * `agentStableId`, as the target for click-to-activate in the sidebar.
   */
  agentName?: string;
  /** For `"review"` and `"handoff"` entries — the target agent's file slug. */
  agentStableId?: string;
}

/**
 * Full flow state snapshot for one agent.
 */
export interface IFlowState {
  /** Display name of the active agent (e.g. "AL Lean SDD"). */
  agentDisplayName: string;
  /** Stable id (agent file slug) used for chat selection + persistence. */
  agentStableId?: string;
  /** Completed steps in chronological order. */
  history: IFlowHistoryStep[];
  /** The step currently in progress, or undefined between steps. */
  active?: IFlowActiveStep;
  /**
   * The planned roadmap of steps for this agent, discovered by parsing the
   * agent's body for `### Step N — <label>` (or `## Step N: <label>`)
   * headings. Rendered as dimmed placeholders after the active step; each
   * planned entry moves out of the roadmap once its label matches history
   * or active.
   */
  planned?: IFlowPlannedStep[];
}

/**
 * Small in-memory store for the current agent flow shown in the sidebar
 * "Agent Flow" view. State is scoped to the current VS Code window (workspace
 * state) so switching workspaces starts fresh, and reloading VS Code keeps
 * the last known position visible.
 *
 * The store is authoritative: the sidebar view, the language model tool
 * (`frw_update_agent_flow`), AND the workspace file watcher on
 * `.vscode/acdc-agent-flow.txt` all read/write through this service, and the
 * emitter fires whenever anything changes so the webview can re-render.
 *
 * The file-based signal is the primary mechanism because it works with any
 * agent that has the `edit` tool — it does not depend on the extension's LM
 * tool being enabled in the current chat session (which can be brittle across
 * VS Code / Copilot versions).
 */
export class FlowStateService {
  private static readonly STORAGE_KEY = "acdc.agentFlowState";
  /** Basename the agent is instructed to write. Location differs per platform. */
  static readonly FLOW_FILE_BASENAME = "acdc-agent-flow.txt";
  /**
   * Absolute path where the agent-flow signal file lives. Placed in the OS
   * temp folder so it never pollutes the workspace and is invisible to git,
   * the file explorer, and any project tooling. Every user's OS provides a
   * writable temp folder, and modern LLMs correctly expand `%TEMP%` (Windows)
   * or `$TMPDIR` / `/tmp` (Unix) when writing via `create_file`.
   */
  static readonly FLOW_FILE_ABSOLUTE = path.join(
    os.tmpdir(),
    FlowStateService.FLOW_FILE_BASENAME
  );
  /** Hook-emitted JSONL events consumed as a deterministic overlay (optional). */
  static readonly HOOK_EVENTS_FILE_BASENAME = "acdc-agent-flow-hooks.jsonl";
  static readonly HOOK_EVENTS_FILE_ABSOLUTE = path.join(
    os.tmpdir(),
    FlowStateService.HOOK_EVENTS_FILE_BASENAME
  );

  private readonly onDidChangeEmitter = new vscode.EventEmitter<IFlowState | undefined>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private state: IFlowState | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private hookWatcher: vscode.FileSystemWatcher | undefined;
  private watcherList: vscode.FileSystemWatcher[] = [];
  private readonly activitySubs: vscode.Disposable[] = [];
  private activityDebounce: NodeJS.Timeout | undefined;
  private lastActivityLabel: string | undefined;
  private activityEnabled = false;
  private hooksOverlayEnabled = false;
  private hookLinesSeen = 0;

  private readonly hookSubagentStack: string[] = [];

  private static flowTempDirectories(): string[] {
    const dirs = new Set<string>();
    const add = (p: string | undefined) => {
      if (!p) {
        return;
      }
      const t = p.trim();
      if (!t) {
        return;
      }
      dirs.add(path.resolve(t));
    };

    add(os.tmpdir());
    add(process.env.TEMP);
    add(process.env.TMP);

    if (process.platform === "win32") {
      add(path.join(process.env.SystemRoot ?? "C:\\Windows", "Temp"));
    }

    return Array.from(dirs);
  }

  private static flowFileCandidates(): vscode.Uri[] {
    return FlowStateService
      .flowTempDirectories()
      .map((dir) => vscode.Uri.file(path.join(dir, FlowStateService.FLOW_FILE_BASENAME)));
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output?: vscode.OutputChannel,
    options?: { hooksOverlayEnabled?: boolean }
  ) {
    this.state = context.workspaceState.get<IFlowState>(FlowStateService.STORAGE_KEY);
    this.hooksOverlayEnabled = options?.hooksOverlayEnabled ?? false;
    this.setupFileWatcher();
    this.setupHookWatcher();
    this.setupActivityTracker();
    // Load any existing file content immediately in case the watcher fires
    // no events before the user first opens the sidebar view.
    void this.readFlowFile();
  }

  setHooksOverlayEnabled(enabled: boolean): void {
    this.hooksOverlayEnabled = enabled;
    this.output?.appendLine(`[flow] hooks overlay ${enabled ? "enabled" : "disabled"}`);
    if (enabled) {
      void this.readHookEventsFile();
    }
  }

  /**
   * Enables/disables the passive activity tracker. When enabled, opening a
   * file or running an edit updates the sidebar with a generic activity label
   * so the user sees the agent is doing SOMETHING even when the agent does
   * not self-report via the flow file or LM tool.
   *
   * The tracker is enabled automatically when an agent is activated and
   * disabled when the flow is manually reset.
   */
  setActivityTrackingEnabled(enabled: boolean): void {
    this.activityEnabled = enabled;
    this.output?.appendLine(`[flow] activity tracking ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Subscribes to lightweight editor-lifecycle events and turns each into a
   * generic "activity step" in the flow. Intentionally passive — does not
   * know WHAT the agent is doing semantically, only that a file was
   * read/edited. Fires debounced to avoid flooding the sidebar.
   *
   * Both editor-focus changes and document edits are treated as activity:
   * agents like Dredd are read-only (only trigger focus changes) whereas
   * agents like Developer edit files. False positives from the user manually
   * clicking around are acceptable — an incorrect file label is less bad UX
   * than a completely silent sidebar.
   */
  private setupActivityTracker(): void {
    const isFlowFile = (uri: vscode.Uri): boolean =>
      path.basename(uri.fsPath).toLowerCase() ===
        FlowStateService.FLOW_FILE_BASENAME.toLowerCase();

    // File-focus activity (Copilot's Read tool opens files in a preview
    // editor, triggering this event).
    this.activitySubs.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) { return; }
        if (editor.document.uri.scheme !== "file") { return; }
        if (isFlowFile(editor.document.uri)) { return; }
        const fileName = editor.document.uri.path.split("/").pop() ?? "file";
        this.recordActivity(`reading ${fileName}`);
      })
    );

    // Document-edit activity (str_replace / create_file / apply_patch).
    this.activitySubs.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme !== "file") { return; }
        if (e.contentChanges.length === 0) { return; }
        if (isFlowFile(e.document.uri)) { return; }
        const fileName = e.document.uri.path.split("/").pop() ?? "file";
        this.recordActivity(`editing ${fileName}`);
      })
    );
  }

  /**
   * Debounced writer for passive activity signals. Skips when tracking is
   * disabled (no agent active) or when the label matches the last one so we
   * don't spam duplicates when the agent lingers on one file.
   */
  private recordActivity(label: string): void {
    if (!this.activityEnabled) { return; }
    if (label === this.lastActivityLabel) { return; }
    this.lastActivityLabel = label;
    if (this.activityDebounce) {
      clearTimeout(this.activityDebounce);
    }
    this.activityDebounce = setTimeout(() => {
      const passiveHandoffTarget = this.inferPassiveHandoffTarget();
      if (passiveHandoffTarget && this.state?.agentDisplayName !== passiveHandoffTarget) {
        this.output?.appendLine(
          `[flow] passive handoff inferred: ${this.state?.agentDisplayName ?? "-"} -> ${passiveHandoffTarget}`
        );
        this.handoffToAgent(passiveHandoffTarget);
      }

      // If the agent has explicitly reported a step, prefer that: only surface
      // activity when the current active label matches a prior activity (or
      // there is no active step yet).
      const current = this.state?.active?.label;
      const isActivityLabel = !current || current.startsWith("editing ") || current.startsWith("reading ");
      if (!isActivityLabel) {
        return;
      }
      if (!this.state) {
        this.state = { agentDisplayName: "Active Agent", history: [] };
      }

      this.state.active = {
        label,
        agentDisplayName: this.state.agentDisplayName,
        startedAt: new Date().toISOString(),
      };
      this.persist();
    }, 400);
  }

  private inferPassiveHandoffTarget(): string | undefined {
    if (!this.state?.planned || this.state.planned.length === 0) {
      return undefined;
    }

    const targets = new Map<string, string>();
    for (const step of this.state.planned) {
      if (step.kind !== "handoff") {
        continue;
      }
      const name = step.agentName?.trim();
      if (!name) {
        continue;
      }
      targets.set(name.toLowerCase(), name);
    }

    if (targets.size !== 1) {
      return undefined;
    }

    const [targetKey, targetName] = Array.from(targets.entries())[0];
    if (!targetName) {
      return undefined;
    }

    if (this.state.agentDisplayName.trim().toLowerCase() === targetKey) {
      return undefined;
    }

    return targetName;
  }

  private inferHandoffTargetFromPrompt(prompt: string): string | undefined {
    if (!this.state?.planned || this.state.planned.length === 0) {
      return undefined;
    }

    const loweredPrompt = prompt.toLowerCase();
    const candidates = this.state.planned
      .filter((s) => s.kind === "handoff" && !!s.agentName)
      .map((s) => s.agentName!.trim())
      .filter((name) => name.length > 0);

    const matches = candidates.filter((name) => loweredPrompt.includes(name.toLowerCase()));
    if (matches.length === 1) {
      return matches[0];
    }
    return undefined;
  }

  /**
   * Watches the agent-flow signal file. Uses TWO overlapping mechanisms so
   * the sidebar reliably updates regardless of how the agent writes:
   *
   *   1. A `FileSystemWatcher` on the exact absolute path in the OS temp
   *      folder. Fires on create/change/delete even when the file isn't
   *      opened in an editor.
   *   2. Text-document listeners matched by filename (`acdc-agent-flow.txt`).
   *      Fire when the agent's `create_file` / `str_replace` tool opens the
   *      file in an editor, which is reliable on every OS and covers the
   *      case where the agent writes the file in an unusual location.
   */
  private setupFileWatcher(): void {
    const candidates = FlowStateService.flowFileCandidates();

    // ── Absolute-path filesystem watchers for each temp root ───────────────
    for (const candidate of candidates) {
      const dirUri = vscode.Uri.file(path.dirname(candidate.fsPath));
      const pattern = new vscode.RelativePattern(
        dirUri,
        FlowStateService.FLOW_FILE_BASENAME
      );
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onEvent = (uri: vscode.Uri) => {
        this.output?.appendLine(`[flow] fs event: ${uri.fsPath}`);
        void this.readFlowFile(uri);
      };
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete((uri) => {
        this.output?.appendLine(`[flow] fs deleted: ${uri.fsPath}`);
        if (this.state?.active) {
          this.completeActive();
        }
      });
      this.watcherList.push(watcher);
      this.output?.appendLine(`[flow] watching: ${candidate.fsPath}`);
    }

    this.watcher = this.watcherList[0];

    // Read the freshest existing candidate at startup.
    void this.readFlowFile();

    // ── Text-document fallback (matches by filename anywhere) ──────────────
    const isFlowFile = (uri: vscode.Uri): boolean =>
      uri.scheme === "file" &&
      path.basename(uri.fsPath).toLowerCase() ===
        FlowStateService.FLOW_FILE_BASENAME.toLowerCase();

    this.activitySubs.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (!isFlowFile(doc.uri)) { return; }
        this.output?.appendLine(`[flow] doc opened: ${doc.uri.fsPath}`);
        this.applyFileContent(doc.getText());
      })
    );
    this.activitySubs.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!isFlowFile(e.document.uri)) { return; }
        this.output?.appendLine(`[flow] doc changed: ${e.document.uri.fsPath}`);
        this.applyFileContent(e.document.getText());
      })
    );
    this.activitySubs.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!isFlowFile(doc.uri)) { return; }
        this.output?.appendLine(`[flow] doc saved: ${doc.uri.fsPath}`);
        this.applyFileContent(doc.getText());
      })
    );

    // Startup scan for already-open documents.
    for (const doc of vscode.workspace.textDocuments) {
      if (isFlowFile(doc.uri)) {
        this.output?.appendLine(`[flow] doc already open at startup: ${doc.uri.fsPath}`);
        this.applyFileContent(doc.getText());
      }
    }
  }

  /**
   * Watches optional hook events emitted to a dedicated JSONL temp file.
   * This overlay is deterministic (session/subagent boundaries) and does not
   * depend on the active agent explicitly reporting those boundaries.
   */
  private setupHookWatcher(): void {
    const hookUri = vscode.Uri.file(FlowStateService.HOOK_EVENTS_FILE_ABSOLUTE);
    const tmpDirUri = vscode.Uri.file(path.dirname(FlowStateService.HOOK_EVENTS_FILE_ABSOLUTE));
    const pattern = new vscode.RelativePattern(
      tmpDirUri,
      FlowStateService.HOOK_EVENTS_FILE_BASENAME
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onEvent = (uri: vscode.Uri) => {
      this.output?.appendLine(`[flow] hook fs event: ${uri.fsPath}`);
      void this.readHookEventsFile(uri);
    };
    watcher.onDidCreate(onEvent);
    watcher.onDidChange(onEvent);
    watcher.onDidDelete((uri) => {
      this.output?.appendLine(`[flow] hook file deleted: ${uri.fsPath}`);
      this.hookLinesSeen = 0;
      this.hookSubagentStack.length = 0;
    });
    this.hookWatcher = watcher;
    void this.readHookEventsFile(hookUri);
  }

  private async readHookEventsFile(uri?: vscode.Uri): Promise<void> {
    if (!this.hooksOverlayEnabled) {
      return;
    }
    const target = uri ?? vscode.Uri.file(FlowStateService.HOOK_EVENTS_FILE_ABSOLUTE);
    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(target);
    } catch {
      return;
    }
    const text = Buffer.from(raw).toString("utf8");
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < this.hookLinesSeen) {
      // File was truncated/rotated.
      this.hookLinesSeen = 0;
      this.hookSubagentStack.length = 0;
    }

    for (let i = this.hookLinesSeen; i < lines.length; i += 1) {
      try {
        const parsed = JSON.parse(lines[i]) as {
          hook_event_name?: string;
          agent_type?: string;
          session_id?: string;
          timestamp?: string;
          prompt?: string;
        };
        this.applyHookEvent(parsed);
      } catch {
        // Skip malformed JSON lines.
      }
    }
    this.hookLinesSeen = lines.length;
  }

  private applyHookEvent(event: {
    hook_event_name?: string;
    agent_type?: string;
    session_id?: string;
    timestamp?: string;
    prompt?: string;
  }): void {
    const eventName = (event.hook_event_name ?? "").trim();
    if (!eventName) {
      return;
    }
    const when = event.timestamp ?? new Date().toISOString();

    if (eventName === "SessionStart") {
      const sessionSuffix = event.session_id ? ` (${event.session_id.slice(0, 8)})` : "";
      this.startStep(`session-start${sessionSuffix}`);
      return;
    }

    if (eventName === "SubagentStart") {
      const subagent = (event.agent_type ?? "Subagent").trim();
      if (!subagent) {
        return;
      }
      this.hookSubagentStack.push(subagent);
      this.handoffToAgent(subagent, `subagent-start: ${subagent}`);
      this.state!.active!.startedAt = when;
      this.persist();
      return;
    }

    if (eventName === "UserPromptSubmit") {
      const prompt = (event.prompt ?? "").trim();
      const promptTarget = prompt.length > 0 ? this.inferHandoffTargetFromPrompt(prompt) : undefined;
      if (promptTarget && this.state?.agentDisplayName !== promptTarget) {
        this.output?.appendLine(
          `[flow] prompt handoff inferred: ${this.state?.agentDisplayName ?? "-"} -> ${promptTarget}`
        );
        this.handoffToAgent(promptTarget, "reading-request");
        this.state!.active!.startedAt = when;
        this.persist();
      }
      return;
    }

    if (eventName === "SubagentStop") {
      const subagent = (event.agent_type ?? this.hookSubagentStack[this.hookSubagentStack.length - 1] ?? "Subagent").trim();
      if (this.state?.active) {
        this.completeActive();
      }
      const idx = this.hookSubagentStack.lastIndexOf(subagent);
      if (idx >= 0) {
        this.hookSubagentStack.splice(idx, 1);
      }
      if (this.state) {
        this.state.active = {
          label: `subagent-stop: ${subagent}`,
          agentDisplayName: subagent,
          startedAt: when,
        };
        this.persist();
      }
      return;
    }

    if (eventName === "Stop") {
      this.completeActive();
    }
  }

  /**
   * Reads the flow file and syncs the in-memory state with its contents.
   * When called without an explicit URI, reads from the canonical absolute
   * path in the OS temp folder.
   *
   * File format (plain text, one step per line):
   *
   *   consulting-bcquality
   *   loading-file
   *   analyzing-diff        # <-- last line = currently active
   *
   * Blank lines are ignored. A line starting with `skill:` on the line
   * immediately after a step attaches that skill to the step.
   */
  private async readFlowFile(uri?: vscode.Uri): Promise<void> {
    let target = uri;
    if (!target) {
      const candidates = FlowStateService.flowFileCandidates();
      let newest: { uri: vscode.Uri; mtime: number } | undefined;
      const existing: { uri: vscode.Uri; mtime: number }[] = [];
      for (const candidate of candidates) {
        try {
          const stat = await vscode.workspace.fs.stat(candidate);
          const mtime = stat.mtime ?? 0;
          existing.push({ uri: candidate, mtime });
          if (!newest || mtime > newest.mtime) {
            newest = { uri: candidate, mtime };
          }
        } catch {
          // Missing candidate is expected.
        }
      }
      if (!newest) {
        return;
      }
      target = newest.uri;

      // Keep one authoritative temp file per session path to avoid divergent
      // flows when `%TEMP%` and `C:\Windows\Temp` are both used.
      for (const item of existing) {
        if (item.uri.fsPath.toLowerCase() === newest.uri.fsPath.toLowerCase()) {
          continue;
        }
        try {
          await vscode.workspace.fs.delete(item.uri, { useTrash: false });
          this.output?.appendLine(`[flow] dedup deleted stale temp file: ${item.uri.fsPath}`);
        } catch {
          // Best-effort dedupe only.
        }
      }
    }

    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(target);
    } catch {
      return;
    }
    const text = Buffer.from(raw).toString("utf8");
    this.applyFileContent(text);
  }

  /**
   * Parses the flow-file body and merges it into the in-memory state.
   * The parse is intentionally forgiving so agents can write the file with
   * `edit`/`writeFile` without ceremony.
   */
  private applyFileContent(text: string): void {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      // Empty file — treat as "no active step" but keep history.
      if (this.state?.active) {
        this.completeActive();
      }
      return;
    }

    interface IParsedStep {
      label: string;
      skill?: string;
      agentDisplayName: string;
    }
    const parseAgentLine = (line: string): string | undefined => {
      const legacy = /^agent\s*:\s*(.+)$/i.exec(line);
      if (legacy) {
        return legacy[1].trim();
      }
      const handoff = /^handoff\s*:\s*(.+)$/i.exec(line);
      if (handoff) {
        return handoff[1].trim();
      }
      const section = /^---\s*agent\s*:\s*(.+?)\s*---$/i.exec(line);
      if (section) {
        return section[1].trim();
      }
      return undefined;
    };

    const fallbackAgent = this.state?.agentDisplayName ?? "Active Agent";
    let currentAgent = fallbackAgent;
    const steps: IParsedStep[] = [];

    for (const line of lines) {
      const declaredAgent = parseAgentLine(line);
      if (declaredAgent) {
        currentAgent = declaredAgent;
        continue;
      }

      const skillMatch = /^skill\s*:\s*(.+)$/i.exec(line);
      if (skillMatch && steps.length > 0) {
        steps[steps.length - 1].skill = skillMatch[1].trim();
        continue;
      }

      steps.push({ label: line, agentDisplayName: currentAgent });
    }

    if (steps.length === 0) {
      return;
    }

    const active = steps[steps.length - 1];
    const history = steps.slice(0, -1);

    // Preserve existing timestamps by index+label+agent; assign now() for new ones.
    const now = new Date().toISOString();
    const previousHistory = this.state?.history ?? [];
    const nextHistory = history.map((s, idx) => {
      const prior = previousHistory[idx];
      const sameAsPrior =
        prior &&
        prior.label === s.label &&
        (prior.agentDisplayName ?? "") === s.agentDisplayName;
      return {
        label: s.label,
        agentDisplayName: s.agentDisplayName,
        skill: s.skill ?? (sameAsPrior ? prior?.skill : undefined),
        completedAt: sameAsPrior ? prior!.completedAt : now,
      };
    });

    const previousActive = this.state?.active;

    const preserveStartedAt =
      previousActive &&
      previousActive.label === active.label &&
      (previousActive.agentDisplayName ?? "") === active.agentDisplayName
        ? previousActive.startedAt
        : now;

    this.state = {
      agentDisplayName: active.agentDisplayName,
      agentStableId:
        this.state?.agentDisplayName === active.agentDisplayName
          ? this.state?.agentStableId
          : undefined,
      history: nextHistory,
      planned:
        this.state?.agentDisplayName === active.agentDisplayName
          ? this.state?.planned
          : undefined,
      active: {
        label: active.label,
        agentDisplayName: active.agentDisplayName,
        skill: active.skill,
        startedAt: preserveStartedAt,
      },
    };

    this.persist();
  }

  get current(): IFlowState | undefined {
    return this.state;
  }

  /**
   * Sets the active agent. If the agent id changes, the flow history is
   * cleared AND the on-disk flow file is deleted so the previous agent's
   * signals don't leak into the new session. If the same agent is re-selected,
   * the existing history is kept so re-invoking an agent mid-conversation does
   * not lose context.
   */
  setActiveAgent(displayName: string, stableId: string | undefined): void {
    const sameAgent =
      this.state &&
      ((stableId && this.state.agentStableId === stableId) ||
        this.state.agentDisplayName === displayName);

    if (sameAgent) {
      // Just refresh the display fields in case they differ; keep flow intact.
      this.state = {
        ...this.state!,
        agentDisplayName: displayName,
        agentStableId: stableId ?? this.state!.agentStableId,
      };
    } else {
      const carriedHistory = this.state?.history ?? [];
      this.state = {
        agentDisplayName: displayName,
        agentStableId: stableId,
        history: carriedHistory,
      };
      // Different agent — clear any leftover file from the previous session.
      // Keep history; only clear active signal so the next write sets context.
      this.state.active = undefined;
    }
    this.persist();
  }

  /**
   * Sets the planned roadmap for the current agent. Called by the extension
   * during agent activation, after parsing the agent body for `### Step N`
   * headings. Idempotent — passing the same array does not fire an event.
   */
  setPlannedFlow(steps: IFlowPlannedStep[]): void {
    if (!this.state) {
      return;
    }
    const same =
      this.state.planned !== undefined &&
      this.state.planned.length === steps.length &&
      this.state.planned.every((p, i) => p.label === steps[i]?.label);
    if (same) {
      return;
    }
    this.state = { ...this.state, planned: steps };
    this.persist();
  }

  /**
   * Marks a new step as the currently-active step. If there was already an
   * active step, it is auto-completed and pushed to history first so the flow
   * always reads as a linear chain.
   */
  startStep(label: string, skill?: string): void {
    if (!this.state) {
      // Tool called before an agent was activated — record label under a
      // placeholder agent so the user still sees progress.
      this.state = {
        agentDisplayName: "Active Agent",
        history: [],
      };
    }
    if (this.state.active) {
      this.state.history.push({
        label: this.state.active.label,
        agentDisplayName: this.state.active.agentDisplayName,
        skill: this.state.active.skill,
        completedAt: new Date().toISOString(),
      });
    }
    this.state.active = {
      label,
      agentDisplayName: this.state.agentDisplayName,
      skill,
      startedAt: new Date().toISOString(),
    };
    this.persist();
  }

  /**
   * Completes the currently-active step (moves it into history) without
   * starting a new one.
   */
  completeActive(): void {
    if (!this.state || !this.state.active) {
      return;
    }
    this.state.history.push({
      label: this.state.active.label,
      agentDisplayName: this.state.active.agentDisplayName,
      skill: this.state.active.skill,
      completedAt: new Date().toISOString(),
    });
    this.state.active = undefined;
    this.persist();
  }

  /**
   * Clears the flow but keeps the active agent so the user does not have to
   * re-select the agent to start a new run.
   */
  resetFlow(): void {
    if (!this.state) {
      return;
    }
    this.state = {
      agentDisplayName: this.state.agentDisplayName,
      agentStableId: this.state.agentStableId,
      history: [],
    };
    this.persist();
    void this.deleteFlowFile();
  }

  /**
   * Clears absolutely everything.
   */
  clear(): void {
    this.state = undefined;
    this.persist();
    void this.deleteFlowFile();
  }

  /**
   * Switches ownership to another agent without dropping history, then starts
   * an optional step for the new agent.
   */
  handoffToAgent(displayName: string, step?: string, skill?: string): void {
    const nextName = displayName.trim();
    if (!nextName) {
      return;
    }
    if (!this.state) {
      this.state = {
        agentDisplayName: nextName,
        history: [],
      };
    } else {
      if (this.state.active) {
        this.completeActive();
      }
      this.state = {
        ...this.state,
        agentDisplayName: nextName,
        agentStableId: undefined,
        planned: undefined,
      };
    }
    if (step) {
      this.state.active = {
        label: step,
        agentDisplayName: nextName,
        skill,
        startedAt: new Date().toISOString(),
      };
    }
    this.persist();
  }

  /**
   * Deletes the agent-flow signal file from the OS temp folder so the
   * transient signal does not linger between sessions. Silently ignores
   * errors — failure to delete never breaks the flow view.
   */
  async deleteFlowFile(): Promise<void> {
    for (const uri of FlowStateService.flowFileCandidates()) {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: false });
        this.output?.appendLine(`[flow] deleted: ${uri.fsPath}`);
      } catch {
        // File missing — nothing to do.
      }
    }
  }

  /**
   * Removes any stale `acdc-agent-flow.txt` files left behind in workspace
   * `.vscode/` folders by previous versions of this extension (which wrote
   * the signal file inside the workspace). One-shot cleanup — runs at
   * activation. New writes always go to the OS temp folder.
   */
  async cleanupLegacyWorkspaceFiles(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const legacy = vscode.Uri.joinPath(folder.uri, ".vscode", FlowStateService.FLOW_FILE_BASENAME);
      try {
        await vscode.workspace.fs.stat(legacy);
        await vscode.workspace.fs.delete(legacy, { useTrash: false });
        this.output?.appendLine(`[flow] cleaned legacy file: ${legacy.fsPath}`);
      } catch {
        // Not present — nothing to do.
      }
    }
  }

  private persist(): void {
    void this.context.workspaceState.update(FlowStateService.STORAGE_KEY, this.state);
    this.output?.appendLine(
      `[flow] state changed: agent=${this.state?.agentDisplayName ?? "-"} active=${this.state?.active?.label ?? "-"} history=${this.state?.history.length ?? 0}`
    );
    this.onDidChangeEmitter.fire(this.state);
  }

  dispose(): void {
    this.watcher?.dispose();
    this.hookWatcher?.dispose();
    this.watcherList.forEach((w) => w.dispose());
    if (this.activityDebounce) {
      clearTimeout(this.activityDebounce);
    }
    for (const sub of this.activitySubs) {
      sub.dispose();
    }
    this.onDidChangeEmitter.dispose();
  }
}
