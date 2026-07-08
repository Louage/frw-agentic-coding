import * as vscode from "vscode";
import {
  type AlSourceEntry,
  getEntries,
  saveEntries,
  listRemoteBranches,
  suggestDefaultFolder,
  validateFolder,
  syncAlBaseCode,
} from "../alBaseCode";

/**
 * Webview panel presenting the AL Base Code / ISV Code sources as an editable
 * table (Repository · Branch · Folder · Enabled) with a live branch picker,
 * folder defaults/browse, and a Save & Apply action that clones/pulls/mounts.
 */
export class AlBaseCodePanel {
  private static current: AlBaseCodePanel | undefined;

  static show(output: vscode.OutputChannel): void {
    if (AlBaseCodePanel.current) {
      AlBaseCodePanel.current.panel.reveal(vscode.ViewColumn.Active);
      AlBaseCodePanel.current.postState();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "acdcAlBaseCodePanel",
      "AL Base Code / ISV Code",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    AlBaseCodePanel.current = new AlBaseCodePanel(panel, output);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly output: vscode.OutputChannel
  ) {
    this.panel.onDidDispose(() => {
      AlBaseCodePanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    this.panel.webview.html = this.getHtml();
  }

  private postState(): void {
    void this.panel.webview.postMessage({
      type: "state",
      entries: getEntries(),
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }
    const msg = message as {
      type?: string;
      index?: number;
      url?: string;
      folder?: string;
      entries?: AlSourceEntry[];
    };

    switch (msg.type) {
      case "ready":
        this.postState();
        break;

      case "listBranches": {
        const index = msg.index ?? -1;
        try {
          const branches = await listRemoteBranches(msg.url ?? "");
          void this.panel.webview.postMessage({
            type: "branches",
            index,
            branches,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void this.panel.webview.postMessage({
            type: "branches",
            index,
            branches: [],
            error: reason,
          });
        }
        break;
      }

      case "suggestFolder": {
        const index = msg.index ?? -1;
        const folder = suggestDefaultFolder(msg.url ?? "");
        void this.panel.webview.postMessage({
          type: "folderSuggested",
          index,
          folder,
        });
        break;
      }

      case "browseFolder": {
        const index = msg.index ?? -1;
        const url = msg.url ?? "";
        const defaultUri = msg.folder
          ? vscode.Uri.file(msg.folder)
          : url
            ? vscode.Uri.file(suggestDefaultFolder(url))
            : undefined;
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri,
          openLabel: url ? "Select clone folder" : "Select source folder",
        });
        if (picked && picked[0]) {
          const folder = picked[0].fsPath;
          const validation = validateFolder(folder, { forClone: !!url });
          void this.panel.webview.postMessage({
            type: "folderPicked",
            index,
            folder,
            valid: validation.ok,
            reason: validation.reason,
          });
        }
        break;
      }

      case "validateFolder": {
        const index = msg.index ?? -1;
        const validation = validateFolder(msg.folder ?? "", {
          forClone: !!(msg.url ?? ""),
        });
        void this.panel.webview.postMessage({
          type: "folderValidated",
          index,
          valid: validation.ok,
          reason: validation.reason,
        });
        break;
      }

      case "save": {
        await saveEntries(msg.entries ?? []);
        vscode.window.showInformationMessage(
          "AL Base Code / ISV Code settings saved."
        );
        this.postState();
        break;
      }

      case "apply": {
        await saveEntries(msg.entries ?? []);
        const results = await syncAlBaseCode(this.output, {
          promptBeforeClone: true,
        });
        const cloned = results.filter((r) => r.outcome === "cloned").length;
        const pulled = results.filter((r) => r.outcome === "pulled").length;
        const manual = results.filter((r) => r.outcome === "skipped").length;
        const errors = results.filter((r) => r.outcome === "error");
        if (errors.length > 0) {
          vscode.window.showWarningMessage(
            `AL Base Code: ${errors.length} error(s). Check the AC⚡DC output.`
          );
        } else {
          const manualNote = manual > 0 ? `, ${manual} manual mounted` : "";
          vscode.window.showInformationMessage(
            `AL Base Code applied: ${cloned} cloned, ${pulled} updated${manualNote}.`
          );
        }
        this.postState();
        break;
      }
    }
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
    <title>AL Base Code / ISV Code</title>
    <style>
      body {
        margin: 0;
        padding: 12px 16px;
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
      }
      h1 { font-size: 1.2em; margin: 0 0 4px; }
      p.hint { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
        vertical-align: top;
      }
      th { font-weight: 600; color: var(--vscode-descriptionForeground); }
      input[type="text"], select {
        width: 100%;
        box-sizing: border-box;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, transparent);
        padding: 4px 6px;
        border-radius: 2px;
      }
      .folder-cell { display: flex; gap: 4px; }
      .folder-cell input { flex: 1; }
      button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 5px 10px;
        border-radius: 2px;
        cursor: pointer;
      }
      button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      button:hover { opacity: 0.9; }
      .row-remove {
        background: none;
        color: var(--vscode-errorForeground, #f14c4c);
        padding: 2px 6px;
      }
      .toolbar { margin-top: 12px; display: flex; gap: 8px; }
      .error { color: var(--vscode-errorForeground, #f14c4c); font-size: 0.85em; margin-top: 2px; }
      .checkbox-cell { text-align: center; width: 60px; }
      .branch-cell { min-width: 160px; }
      .actions-cell { white-space: nowrap; width: 90px; }
      .loading { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.85em; }
    </style>
  </head>
  <body>
    <h1>AL Base Code / ISV Code</h1>
    <p class="hint">
      Read-only AL source repositories (BC base app + ISV products) mounted for agent grounding.
      Missing folders are cloned after you approve; existing folders are pulled to the latest commit (never pushed).
      Leave <b>Repository</b> empty for a <b>manual</b> source (e.g. an ISV file download): the extension only mounts the folder and never updates it — you maintain it yourself.
    </p>
    <table>
      <thead>
        <tr>
          <th>Repository</th>
          <th class="branch-cell">Branch</th>
          <th>Folder</th>
          <th class="checkbox-cell">Enabled</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="toolbar">
      <button id="add" class="secondary">+ Add source</button>
      <button id="save" class="secondary">Save</button>
      <button id="apply">Save &amp; Apply</button>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let entries = [];

      function h(html) {
        return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }

      function render() {
        const tbody = document.getElementById("rows");
        tbody.innerHTML = "";
        entries.forEach((e, i) => {
          const manual = !(e.repository || "").trim();
          const tr = document.createElement("tr");
          tr.innerHTML =
            '<td>' +
              '<input type="text" data-field="repository" data-index="' + i + '" value="' + h(e.repository || "") + '" placeholder="(leave empty for a manual folder)" />' +
            '</td>' +
            '<td class="branch-cell">' +
              '<select data-field="branch" data-index="' + i + '"' + (manual ? ' disabled' : '') + '>' +
                (manual
                  ? '<option value="">(manual — update yourself)</option>'
                  : (e.branch ? '<option value="' + h(e.branch) + '" selected>' + h(e.branch) + '</option>' : '<option value="">(pick a branch)</option>')) +
              '</select>' +
              '<div class="branch-status" data-branch-status="' + i + '"></div>' +
            '</td>' +
            '<td>' +
              '<div class="folder-cell">' +
                '<input type="text" data-field="folder" data-index="' + i + '" value="' + h(e.folder || "") + '" placeholder="' + (manual ? 'folder you maintain yourself' : '(default under %LOCALAPPDATA%)') + '" />' +
                '<button class="secondary" data-browse="' + i + '">…</button>' +
              '</div>' +
              '<div class="error" data-folder-error="' + i + '"></div>' +
            '</td>' +
            '<td class="checkbox-cell">' +
              '<input type="checkbox" data-field="enabled" data-index="' + i + '" ' + (e.enabled ? "checked" : "") + ' />' +
            '</td>' +
            '<td class="actions-cell">' +
              '<button class="secondary" data-branches="' + i + '"' + (manual ? ' disabled' : '') + '>Branches</button>' +
              '<button class="row-remove" data-remove="' + i + '">Remove</button>' +
            '</td>';
          tbody.appendChild(tr);
        });
      }

      function updateRowManualState(idx) {
        const manual = !(entries[idx].repository || "").trim();
        const select = document.querySelector('select[data-field="branch"][data-index="' + idx + '"]');
        const branchesBtn = document.querySelector('[data-branches="' + idx + '"]');
        if (select) {
          select.disabled = manual;
          if (manual) {
            select.innerHTML = '<option value="">(manual — update yourself)</option>';
            entries[idx].branch = "";
          } else if (select.options.length === 1 && select.options[0].value === "") {
            select.innerHTML = '<option value="">(pick a branch)</option>';
          }
        }
        if (branchesBtn) branchesBtn.disabled = manual;
        const folderInput = document.querySelector('input[data-field="folder"][data-index="' + idx + '"]');
        if (folderInput) folderInput.placeholder = manual ? 'folder you maintain yourself' : '(default under %LOCALAPPDATA%)';
      }

      document.addEventListener("input", (ev) => {
        const t = ev.target;
        const field = t.getAttribute("data-field");
        if (field === null) return;
        const idx = parseInt(t.getAttribute("data-index"), 10);
        if (field === "enabled") {
          entries[idx].enabled = t.checked;
        } else {
          entries[idx][field] = t.value;
        }
        if (field === "repository") {
          updateRowManualState(idx);
        }
        if (field === "folder") {
          vscode.postMessage({ type: "validateFolder", index: idx, folder: t.value, url: entries[idx].repository });
        }
      });

      document.addEventListener("click", (ev) => {
        const t = ev.target;
        if (t.hasAttribute("data-browse")) {
          const idx = parseInt(t.getAttribute("data-browse"), 10);
          vscode.postMessage({ type: "browseFolder", index: idx, url: entries[idx].repository, folder: entries[idx].folder });
        } else if (t.hasAttribute("data-branches")) {
          const idx = parseInt(t.getAttribute("data-branches"), 10);
          const status = document.querySelector('[data-branch-status="' + idx + '"]');
          if (status) status.className = "loading", status.textContent = "Loading branches…";
          if (!entries[idx].folder) {
            vscode.postMessage({ type: "suggestFolder", index: idx, url: entries[idx].repository });
          }
          vscode.postMessage({ type: "listBranches", index: idx, url: entries[idx].repository });
        } else if (t.hasAttribute("data-remove")) {
          const idx = parseInt(t.getAttribute("data-remove"), 10);
          entries.splice(idx, 1);
          render();
        }
      });

      document.getElementById("add").addEventListener("click", () => {
        entries.push({ repository: "", branch: "", folder: "", enabled: false });
        render();
      });
      document.getElementById("save").addEventListener("click", () => {
        vscode.postMessage({ type: "save", entries: entries });
      });
      document.getElementById("apply").addEventListener("click", () => {
        vscode.postMessage({ type: "apply", entries: entries });
      });

      window.addEventListener("message", (ev) => {
        const m = ev.data;
        if (m.type === "state") {
          entries = (m.entries || []).map((e) => ({ repository: e.repository || "", branch: e.branch || "", folder: e.folder || "", enabled: !!e.enabled }));
          render();
        } else if (m.type === "branches") {
          const idx = m.index;
          const status = document.querySelector('[data-branch-status="' + idx + '"]');
          const select = document.querySelector('select[data-field="branch"][data-index="' + idx + '"]');
          if (m.error) {
            if (status) status.className = "error", status.textContent = m.error;
            return;
          }
          if (status) status.textContent = "";
          if (select) {
            const current = entries[idx].branch;
            select.innerHTML = '<option value="">(pick a branch)</option>' +
              m.branches.map((b) => '<option value="' + h(b) + '"' + (b === current ? " selected" : "") + '>' + h(b) + '</option>').join("");
          }
        } else if (m.type === "folderSuggested") {
          if (!entries[m.index].folder) {
            entries[m.index].folder = m.folder;
            const input = document.querySelector('input[data-field="folder"][data-index="' + m.index + '"]');
            if (input) input.value = m.folder;
          }
        } else if (m.type === "folderPicked") {
          entries[m.index].folder = m.folder;
          const input = document.querySelector('input[data-field="folder"][data-index="' + m.index + '"]');
          if (input) input.value = m.folder;
          const err = document.querySelector('[data-folder-error="' + m.index + '"]');
          if (err) err.textContent = m.valid ? "" : (m.reason || "");
        } else if (m.type === "folderValidated") {
          const err = document.querySelector('[data-folder-error="' + m.index + '"]');
          if (err) err.textContent = m.valid ? "" : (m.reason || "");
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
