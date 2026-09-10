import * as vscode from "vscode";
import {
  toDeltas,
  toggleExpanded,
  toggleGroup,
  toggleTool,
  type ToolPickerState,
} from "../tools/toolPickerModel";
import {
  classifyUnavailableTokens,
  type AvailabilityContext,
} from "../tools/toolPickerPresentation";

export interface ToolPickerPanelOptions {
  agentName: string;
  declaredTools: string[];
  initialState: ToolPickerState;
  availability: AvailabilityContext;
  /** Commits back into the Agent Settings panel's pending state; nothing is written here. */
  onCommit: (deltas: { disabledTools: string[]; extraTools: string[] }) => void;
}

/**
 * The tool picker as an editor-tab webview tree (D20).
 *
 * A QuickPick cannot express this: VS Code's own tool picker is built on
 * `IQuickInputService.createQuickTree()`, which is workbench-internal and appears nowhere
 * in `vscode.d.ts` or any `vscode.proposed.*.d.ts`. A webview is the only surface on
 * stable API that can draw collapsible parents with **tri-state** checkboxes (D22), which
 * is what a partially selected group needs.
 *
 * All selection logic stays in the vscode-free reducers (D21): the webview is a renderer
 * that posts gestures, the host applies `toggleGroup` / `toggleTool` / `toggleExpanded` and
 * posts the new view model back. Checking a parent still persists the group wildcard, not
 * an enumeration (D8).
 */
export class ToolPickerPanel {
  private static current: ToolPickerPanel | undefined;

  static show(options: ToolPickerPanelOptions): void {
    if (ToolPickerPanel.current) {
      ToolPickerPanel.current.adopt(options);
      ToolPickerPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "acdcToolPickerPanel",
      "Configure Tools",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    ToolPickerPanel.current = new ToolPickerPanel(panel, options);
  }

  private state: ToolPickerState;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private options: ToolPickerPanelOptions
  ) {
    this.state = options.initialState;
    this.panel.onDidDispose(() => {
      ToolPickerPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.webview.html = this.getHtml();
  }

  /** Reopening for a different agent replaces the state rather than stacking panels. */
  private adopt(options: ToolPickerPanelOptions): void {
    this.options = options;
    this.state = options.initialState;
    this.panel.webview.html = this.getHtml();
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }
    const msg = message as { type?: string; key?: string; id?: string; checked?: boolean };

    switch (msg.type) {
      case "ready":
        this.postState();
        break;
      case "toggleGroup":
        if (msg.key !== undefined) {
          this.state = toggleGroup(this.state, msg.key, msg.checked === true);
          this.postState();
        }
        break;
      case "toggleTool":
        if (msg.id !== undefined) {
          this.state = toggleTool(this.state, msg.id, msg.checked === true);
          this.postState();
        }
        break;
      case "toggleExpanded":
        if (msg.key !== undefined) {
          this.state = toggleExpanded(this.state, msg.key);
          this.postState();
        }
        break;
      case "expandAll":
      case "collapseAll": {
        const expand = msg.type === "expandAll";
        for (const group of this.state.groups) {
          if (group.expanded !== expand) {
            this.state = toggleExpanded(this.state, group.key);
          }
        }
        this.postState();
        break;
      }
      case "commit":
        this.options.onCommit(toDeltas(this.state, this.options.declaredTools));
        this.panel.dispose();
        break;
      case "cancel":
        this.panel.dispose();
        break;
    }
  }

  private postState(): void {
    void this.panel.webview.postMessage({ type: "state", model: this.buildViewModel() });
  }

  private buildViewModel(): Record<string, unknown> {
    const declared = new Set(this.options.declaredTools);
    const checkedTools = new Set<string>();
    let tokenCount = 0;

    const groups = this.state.groups.map((group) => {
      const checked = new Set(group.checked);
      for (const id of group.checked) {
        checkedTools.add(id);
      }
      tokenCount += group.wildcardSelected && group.owner.wildcardId ? 1 : group.checked.length;
      return {
        key: group.key,
        label: group.owner.label,
        kind: group.owner.kind,
        wildcardId: group.owner.wildcardId ?? "",
        state: group.state,
        expanded: group.expanded,
        wildcardSelected: group.wildcardSelected,
        checkedCount: group.checked.length,
        children: group.children.map((child) => ({
          id: child.qualifiedId,
          label: child.label,
          description: child.description,
          checked: checked.has(child.qualifiedId),
          declared: declared.has(child.qualifiedId),
        })),
      };
    });

    const unavailable = classifyUnavailableTokens(
      this.state.orphans,
      this.options.availability
    ).map((info) => ({ ...info, declared: declared.has(info.token) }));

    return {
      title: `Tools for ${this.options.agentName}`,
      groups,
      unavailable,
      counts: {
        tools: checkedTools.size + unavailable.length,
        tokens: tokenCount + unavailable.length,
      },
    };
  }

  private getHtml(): string {
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Configure Tools</title>
    <style>
      :root {
        color-scheme: light dark;
        --panel: var(--vscode-editor-background);
        --text: var(--vscode-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-panel-border, rgba(127,127,127,0.25));
        --accent: var(--vscode-button-background);
        --accent-fg: var(--vscode-button-foreground);
        --accent-2: var(--vscode-button-secondaryBackground);
        --hover: var(--vscode-list-hoverBackground);
      }
      body {
        margin: 0;
        padding: 0 0 84px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--text);
        background: var(--panel);
      }
      header {
        position: sticky; top: 0; z-index: 2;
        background: var(--panel);
        border-bottom: 1px solid var(--border);
        padding: 12px 16px 10px;
      }
      h1 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 600; }
      .toolbar { display: flex; gap: 8px; align-items: center; }
      #filter {
        flex: 1; min-width: 0; box-sizing: border-box;
        border-radius: 4px; border: 1px solid var(--vscode-input-border, var(--border));
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        padding: 5px 8px; font: inherit;
      }
      #filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
      button {
        border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer;
        background: var(--accent); color: var(--accent-fg); font: inherit; white-space: nowrap;
      }
      button.secondary {
        background: var(--accent-2); color: var(--vscode-button-secondaryForeground);
      }
      .subtle { color: var(--muted); font-size: 0.85rem; }
      #tree { padding: 6px 16px 0; }
      .row {
        display: flex; align-items: flex-start; gap: 6px;
        padding: 3px 6px; border-radius: 4px; min-height: 22px;
      }
      .row:hover { background: var(--hover); }
      .row.child { padding-left: 30px; }
      .row.unavailable { padding-left: 6px; }
      .twisty {
        flex: none; width: 16px; text-align: center; cursor: pointer;
        color: var(--muted); user-select: none; line-height: 1.4;
        background: none; border: none; padding: 0; font: inherit;
      }
      .twisty:hover { color: var(--text); }
      .twisty.leaf { visibility: hidden; cursor: default; }
      input[type="checkbox"] { flex: none; margin: 3px 0 0; accent-color: var(--accent); }
      label.row-label {
        display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
        margin: 0; font-weight: normal; cursor: pointer; min-width: 0; flex: 1;
      }
      .row.group label.row-label { font-weight: 600; }
      .name { overflow: hidden; text-overflow: ellipsis; }
      .meta { color: var(--muted); font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; }
      .badge {
        border: 1px solid var(--border); border-radius: 999px;
        padding: 0 7px; font-size: 0.72rem; color: var(--muted); white-space: nowrap;
      }
      .section {
        margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border);
      }
      .section h2 { margin: 0 0 2px; font-size: 0.9rem; }
      .section .lead { margin-bottom: 6px; }
      .reason { color: var(--muted); font-size: 0.82rem; }
      .empty { color: var(--muted); font-style: italic; padding: 8px 6px; }
      footer {
        position: fixed; left: 0; right: 0; bottom: 0;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 10px 16px; background: var(--panel); border-top: 1px solid var(--border);
      }
      .actions { display: flex; gap: 8px; }
    </style>
  </head>
  <body>
    <header>
      <h1 id="title">Configure Tools</h1>
      <div class="toolbar">
        <input id="filter" type="text" placeholder="Search tools…" autocomplete="off" />
        <button id="expand-all" type="button" class="secondary">Expand all</button>
        <button id="collapse-all" type="button" class="secondary">Collapse all</button>
      </div>
    </header>

    <div id="tree"></div>

    <footer>
      <div id="summary" class="subtle"></div>
      <div class="actions">
        <button id="cancel" type="button" class="secondary">Cancel</button>
        <button id="ok" type="button">OK</button>
      </div>
    </footer>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let model = null;
      let filter = '';

      function send(type, payload) {
        vscode.postMessage(Object.assign({ type: type }, payload || {}));
      }

      function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined) { node.textContent = text; }
        return node;
      }

      function matches(text) {
        return !filter || String(text || '').toLowerCase().includes(filter);
      }

      function checkbox(state, onChange, disabled) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = state === 'checked';
        // Tri-state (D22): a partially selected group renders indeterminate rather than
        // unchecked-with-a-caption, which is what no QuickPick could express.
        box.indeterminate = state === 'partial';
        if (disabled) {
          box.disabled = true;
          box.title = 'This tool stays granted; it cannot be removed here.';
        } else {
          box.addEventListener('change', () => onChange(box.checked));
        }
        return box;
      }

      function groupRow(group, visibleChildren) {
        const row = el('div', 'row group');

        const twisty = el('button', 'twisty', group.expanded ? '\\u25BE' : '\\u25B8');
        twisty.type = 'button';
        twisty.setAttribute('aria-label', group.expanded ? 'Collapse' : 'Expand');
        twisty.addEventListener('click', () => send('toggleExpanded', { key: group.key }));
        row.appendChild(twisty);

        row.appendChild(checkbox(group.state, (checked) =>
          send('toggleGroup', { key: group.key, checked: checked })));

        const label = el('label', 'row-label');
        label.appendChild(el('span', 'name', group.label));
        const bits = [group.children.length + (group.children.length === 1 ? ' tool' : ' tools')];
        if (group.wildcardId) { bits.push(group.wildcardId); }
        if (group.state === 'partial') { bits.push(group.checkedCount + ' selected'); }
        if (filter) { bits.push(visibleChildren.length + ' matching'); }
        label.appendChild(el('span', 'meta', bits.join(' \\u00B7 ')));
        label.addEventListener('click', (event) => {
          if (event.target === label || event.target.className === 'name' || event.target.className === 'meta') {
            event.preventDefault();
            send('toggleExpanded', { key: group.key });
          }
        });
        row.appendChild(label);
        return row;
      }

      function childRow(group, child) {
        const row = el('div', 'row child');
        row.appendChild(el('span', 'twisty leaf', '\\u00B7'));
        row.appendChild(checkbox(child.checked ? 'checked' : 'unchecked', (checked) =>
          send('toggleTool', { id: child.id, checked: checked })));
        const label = el('label', 'row-label');
        label.appendChild(el('span', 'name', child.label));
        label.appendChild(el('span', 'meta', child.id));
        if (child.declared) { label.appendChild(el('span', 'badge', 'declared')); }
        if (child.description) { label.title = child.description; }
        row.appendChild(label);
        return row;
      }

      function unavailableRow(entry) {
        const row = el('div', 'row unavailable');
        row.appendChild(checkbox('checked', (checked) =>
          send('toggleTool', { id: entry.token, checked: checked }), !entry.removable));
        const label = el('label', 'row-label');
        label.appendChild(el('span', 'name', entry.token));
        label.appendChild(el('span', 'badge', entry.badge));
        if (entry.declared) { label.appendChild(el('span', 'badge', 'declared')); }
        label.appendChild(el('span', 'reason', entry.reason));
        row.appendChild(label);
        return row;
      }

      function render() {
        const tree = document.getElementById('tree');
        const scroll = window.scrollY;
        document.getElementById('title').textContent = model.title;
        tree.textContent = '';

        let shown = 0;
        model.groups.forEach((group) => {
          const groupMatches = matches(group.label) || matches(group.wildcardId);
          const visibleChildren = group.children.filter((child) =>
            groupMatches || matches(child.label) || matches(child.id) || matches(child.description));
          if (filter && !groupMatches && visibleChildren.length === 0) {
            return;
          }
          shown += 1;
          tree.appendChild(groupRow(group, visibleChildren));
          // A filter auto-expands its hits without mutating the persisted expansion state.
          if (group.expanded || (filter && visibleChildren.length > 0)) {
            visibleChildren.forEach((child) => tree.appendChild(childRow(group, child)));
          }
        });

        const unavailable = model.unavailable.filter((entry) =>
          matches(entry.token) || matches(entry.badge));
        if (unavailable.length > 0) {
          const section = el('div', 'section');
          section.appendChild(el('h2', null, 'Not listed above'));
          section.appendChild(el('div', 'lead subtle',
            'These tools are declared by the agent but are not in the list right now. ' +
            'They stay granted unless the row can be — and is — unchecked.'));
          unavailable.forEach((entry) => section.appendChild(unavailableRow(entry)));
          tree.appendChild(section);
          shown += 1;
        }

        if (shown === 0) {
          tree.appendChild(el('div', 'empty', 'No tools match "' + filter + '".'));
        }

        const counts = model.counts;
        document.getElementById('summary').textContent =
          counts.tools + (counts.tools === 1 ? ' tool granted' : ' tools granted') +
          ' \\u00B7 ' + counts.tokens + (counts.tokens === 1 ? ' token' : ' tokens');
        window.scrollTo(0, scroll);
      }

      document.getElementById('filter').addEventListener('input', (event) => {
        filter = event.target.value.trim().toLowerCase();
        if (model) { render(); }
      });
      document.getElementById('expand-all').addEventListener('click', () => send('expandAll'));
      document.getElementById('collapse-all').addEventListener('click', () => send('collapseAll'));
      document.getElementById('ok').addEventListener('click', () => send('commit'));
      document.getElementById('cancel').addEventListener('click', () => send('cancel'));

      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'state') {
          model = event.data.model;
          render();
        }
      });

      send('ready');
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}
