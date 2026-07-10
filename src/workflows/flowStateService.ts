import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";

/**
 * A single completed step in the agent's flow history.
 */
export interface IFlowHistoryStep {
  label: string;
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

  private readonly onDidChangeEmitter = new vscode.EventEmitter<IFlowState | undefined>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private state: IFlowState | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private watcherList: vscode.FileSystemWatcher[] = [];
  private readonly activitySubs: vscode.Disposable[] = [];
  private activityDebounce: NodeJS.Timeout | undefined;
  private lastActivityLabel: string | undefined;
  private activityEnabled = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output?: vscode.OutputChannel
  ) {
    this.state = context.workspaceState.get<IFlowState>(FlowStateService.STORAGE_KEY);
    this.setupFileWatcher();
    this.setupActivityTracker();
    // Load any existing file content immediately in case the watcher fires
    // no events before the user first opens the sidebar view.
    void this.readFlowFile();
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
        startedAt: new Date().toISOString(),
      };
      this.persist();
    }, 400);
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
    const flowUri = vscode.Uri.file(FlowStateService.FLOW_FILE_ABSOLUTE);
    const tmpDirUri = vscode.Uri.file(path.dirname(FlowStateService.FLOW_FILE_ABSOLUTE));

    // ── Absolute-path filesystem watcher ────────────────────────────────────
    const pattern = new vscode.RelativePattern(
      tmpDirUri,
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
    this.watcher = watcher;
    this.output?.appendLine(`[flow] watching: ${flowUri.fsPath}`);

    // Also read the file immediately in case it exists from a previous session.
    void this.readFlowFile(flowUri);

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
    const target = uri ?? vscode.Uri.file(FlowStateService.FLOW_FILE_ABSOLUTE);
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

    // Optional `agent: <name>` header on the first line — used when Copilot
    // hands off to a different chat participant so the sidebar can switch
    // agents (and re-parse the planned roadmap) without a manual reselect.
    const agentHeaderMatch = /^agent\s*:\s*(.+)$/i.exec(lines[0]);
    let agentSwitched = false;
    if (agentHeaderMatch) {
      const declaredAgent = agentHeaderMatch[1].trim();
      lines.shift(); // Consume the header line.
      if (declaredAgent && declaredAgent !== this.state?.agentDisplayName) {
        // New agent — reset history + let subscribers re-seed planned flow.
        this.state = {
          agentDisplayName: declaredAgent,
          agentStableId: undefined,
          history: [],
        };
        agentSwitched = true;
        this.output?.appendLine(`[flow] agent switch detected from file: ${declaredAgent}`);
      }
    }

    if (lines.length === 0) {
      // File only had the agent header — persist the switch and stop.
      if (agentSwitched) { this.persist(); }
      return;
    }

    // Extract optional "skill: <name>" annotations that follow a step line.
    interface IParsedStep { label: string; skill?: string; }
    const steps: IParsedStep[] = [];
    for (const line of lines) {
      const skillMatch = /^skill\s*:\s*(.+)$/i.exec(line);
      if (skillMatch && steps.length > 0) {
        steps[steps.length - 1].skill = skillMatch[1].trim();
        continue;
      }
      steps.push({ label: line });
    }

    if (steps.length === 0) {
      if (agentSwitched) { this.persist(); }
      return;
    }

    // Ensure there is some agent set — the file may arrive before the user
    // activates an agent from the tree.
    if (!this.state) {
      this.state = { agentDisplayName: "Active Agent", history: [] };
    }

    const active = steps[steps.length - 1];
    const history = steps.slice(0, -1);

    // Preserve existing timestamps where labels match; assign now() for new ones.
    const now = new Date().toISOString();
    const previousHistoryByLabel = new Map(this.state.history.map((h) => [h.label, h]));
    this.state.history = history.map((s) => {
      const prior = previousHistoryByLabel.get(s.label);
      return {
        label: s.label,
        skill: s.skill ?? prior?.skill,
        completedAt: prior?.completedAt ?? now,
      };
    });

    const preserveStartedAt =
      this.state.active && this.state.active.label === active.label
        ? this.state.active.startedAt
        : now;
    this.state.active = {
      label: active.label,
      skill: active.skill,
      startedAt: preserveStartedAt,
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
      this.state = {
        agentDisplayName: displayName,
        agentStableId: stableId,
        history: [],
      };
      // Different agent — clear any leftover file from the previous session.
      void this.deleteFlowFile();
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
        skill: this.state.active.skill,
        completedAt: new Date().toISOString(),
      });
    }
    this.state.active = {
      label,
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
   * Deletes the agent-flow signal file from the OS temp folder so the
   * transient signal does not linger between sessions. Silently ignores
   * errors — failure to delete never breaks the flow view.
   */
  async deleteFlowFile(): Promise<void> {
    const uri = vscode.Uri.file(FlowStateService.FLOW_FILE_ABSOLUTE);
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: false });
      this.output?.appendLine(`[flow] deleted: ${uri.fsPath}`);
    } catch {
      // File missing — nothing to do.
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
