import * as vscode from "vscode";
import {
  type AlSourceEntry,
  effectiveFolder,
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
      // Fully rebuild the webview HTML so recent script/UI changes take effect
      // even when the panel was previously opened in this session (webviews
      // otherwise cache the initial HTML with retainContextWhenHidden).
      AlBaseCodePanel.current.reloadWebview();
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

  private reloadWebview(): void {
    this.panel.webview.html = this.getHtml();
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

  private validateEntries(entries: AlSourceEntry[]): string[] {
    const errors: string[] = [];
    entries.forEach((entry, index) => {
      const row = index + 1;
      const repository = (entry.repository ?? "").trim();
      const branch = (entry.branch ?? "").trim();
      const baseFolder = (entry.folder ?? "").trim();

      if (!repository) {
        if (branch) {
          errors.push(`Row ${row}: Branch requires a repository.`);
        }
        if (baseFolder) {
          const validation = validateFolder(baseFolder, { forClone: false });
          if (!validation.ok) {
            errors.push(`Row ${row}: ${validation.reason}`);
          }
        }
        return;
      }

      if (!branch) {
        errors.push(`Row ${row}: Branch is required when repository is set.`);
      }
      if (!baseFolder) {
        errors.push(`Row ${row}: Base folder is required when repository is set.`);
        return;
      }

      const validation = validateFolder(effectiveFolder(entry));
      if (!validation.ok) {
        errors.push(`Row ${row}: ${validation.reason}`);
      }
    });
    return errors;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }
    const msg = message as {
      type?: string;
      index?: number;
      url?: string;
      branch?: string;
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
        const folder = suggestDefaultFolder(msg.url ?? "", msg.branch ?? "");
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
        const branch = msg.branch ?? "";
        const defaultUri = msg.folder
          ? vscode.Uri.file(msg.folder)
          : url
            ? vscode.Uri.file(suggestDefaultFolder(url, branch))
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
          const validation = url
            ? validateFolder(
                effectiveFolder({
                  repository: url,
                  branch,
                  folder,
                  enabled: true,
                })
              )
            : validateFolder(folder, { forClone: false });
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
        const repository = msg.url ?? "";
        const branch = msg.branch ?? "";
        const folder = msg.folder ?? "";
        const validation = repository
          ? validateFolder(
              effectiveFolder({
                repository,
                branch,
                folder,
                enabled: true,
              })
            )
          : validateFolder(folder, { forClone: false });
        void this.panel.webview.postMessage({
          type: "folderValidated",
          index,
          valid: validation.ok,
          reason: validation.reason,
        });
        break;
      }

      case "save": {
        const entries = msg.entries ?? [];
        const errors = this.validateEntries(entries);
        if (errors.length > 0) {
          vscode.window.showWarningMessage(
            `Cannot save AL Base Code settings: ${errors[0]}`
          );
          return;
        }
        await saveEntries(entries);
        vscode.window.showInformationMessage(
          "AL Base Code / ISV Code settings saved."
        );
        this.postState();
        break;
      }

      case "apply": {
        const entries = msg.entries ?? [];
        const errors = this.validateEntries(entries);
        if (errors.length > 0) {
          vscode.window.showWarningMessage(
            `Cannot apply AL Base Code settings: ${errors[0]}`
          );
          return;
        }
        await saveEntries(entries);
        const results = await syncAlBaseCode(this.output, {
          promptBeforeClone: true,
        });
        const cloned = results.filter((r) => r.outcome === "cloned").length;
        const pulled = results.filter((r) => r.outcome === "pulled").length;
        const manual = results.filter((r) => r.outcome === "skipped").length;
        const syncErrors = results.filter((r) => r.outcome === "error");
        if (syncErrors.length > 0) {
          vscode.window.showWarningMessage(
            `AL Base Code: ${syncErrors.length} error(s). Check the AC⚡DC output.`
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
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
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
      .repository-cell { width: 18%; }
      .branch-cell { width: 10%; }
      .base-cell { width: 34%; }
      .repo-cell { width: 16%; }
      .derived-cell { width: 10%; }
      .checkbox-cell { width: 6%; }
      .actions-cell { white-space: nowrap; width: 6%; }
      .loading { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.85em; }
      input[readonly] {
        opacity: 0.8;
        background: var(--vscode-input-background);
      }
    </style>
  </head>
  <body>
    <h1>AL Base Code / ISV Code <span style="font-size:0.7em;color:var(--vscode-descriptionForeground);">(build ${nonce.slice(0, 6)})</span></h1>
    <p class="hint">
      Read-only AL source repositories (BC base app + ISV products) mounted for agent grounding.
      Target path is resolved as <b>Base Folder / Repo Folder / Branch Folder</b>.
      Missing folders are cloned after you approve; existing folders are pulled to the latest commit (never pushed).
      Leave <b>Repository</b> empty for a <b>manual</b> source (e.g. an ISV file download): the extension only mounts the folder and never updates it — you maintain it yourself.
    </p>
    <table>
      <colgroup>
        <col style="width:18%" />
        <col style="width:10%" />
        <col style="width:34%" />
        <col style="width:16%" />
        <col style="width:10%" />
        <col style="width:6%" />
        <col style="width:6%" />
      </colgroup>
      <thead>
        <tr>
          <th class="repository-cell">Repository</th>
          <th class="branch-cell">Branch</th>
          <th class="base-cell">Base Folder</th>
          <th class="repo-cell">Repo Folder</th>
          <th class="derived-cell">Branch Folder</th>
          <th class="checkbox-cell">Enabled</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="toolbar">
      <button id="add" type="button" data-action="add" class="secondary">+ Add source</button>
      <button id="save" type="button" class="secondary">Save</button>
      <button id="apply" type="button">Save &amp; Apply</button>
    </div>

    <script nonce="${nonce}">
      window.onerror = function (message, source, lineno, colno, error) {
        try {
          const h1 = document.querySelector("h1");
          if (h1) {
            h1.style.color = "var(--vscode-errorForeground,#f14c4c)";
            h1.textContent = "AL Base Code (script error): " + message + " @ " + lineno + ":" + colno;
          }
        } catch (e) { /* ignore */ }
        return false;
      };

      const vscode = acquireVsCodeApi();
      let entries = [];
      const folderErrors = {};
      const branchLoadTimers = {};

      function h(html) {
        return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }

      function repoFolderFromRepository(url) {
        const trimmed = (url || "").trim().replace(/\\.git$/i, "").replace(/\\/+$/, "");
        const segments = trimmed.split(/[\\\\/]/);
        return segments.length ? (segments[segments.length - 1] || "") : "";
      }

      function branchFolderFromBranch(branch) {
        return (branch || "").trim().replace(/[\\\\/:*?"<>|]+/g, "_");
      }

      function setDerivedFolders(idx) {
        const e = entries[idx];
        const repoFolder = (e.repository || "").trim() ? repoFolderFromRepository(e.repository) : "";
        const branchFolder = (e.repository || "").trim() && (e.branch || "").trim()
          ? branchFolderFromBranch(e.branch)
          : "";
        const repoEl = document.querySelector('input[data-repo-folder="' + idx + '"]');
        const branchEl = document.querySelector('input[data-branch-folder="' + idx + '"]');
        if (repoEl) repoEl.value = repoFolder;
        if (branchEl) branchEl.value = branchFolder;
      }

      function postValidateFolder(idx) {
        vscode.postMessage({
          type: "validateFolder",
          index: idx,
          folder: entries[idx].folder,
          url: entries[idx].repository,
          branch: entries[idx].branch,
        });
      }

      function ensureBaseFolder(idx) {
        if ((entries[idx].repository || "").trim() && !(entries[idx].folder || "").trim()) {
          vscode.postMessage({
            type: "suggestFolder",
            index: idx,
            url: entries[idx].repository,
            branch: entries[idx].branch,
          });
        }
      }

      function requestBranches(idx, immediate) {
        const repository = (entries[idx].repository || "").trim();
        const status = document.querySelector('[data-branch-status="' + idx + '"]');
        if (!repository) {
          if (status) status.textContent = "";
          return;
        }
        if (branchLoadTimers[idx]) {
          clearTimeout(branchLoadTimers[idx]);
        }
        const run = () => {
          if (status) {
            status.className = "loading";
            status.textContent = "Loading branches…";
          }
          vscode.postMessage({ type: "listBranches", index: idx, url: repository });
        };
        if (immediate) {
          run();
          return;
        }
        branchLoadTimers[idx] = setTimeout(run, 350);
      }

      function rowValidationMessage(idx) {
        const e = entries[idx];
        const repository = (e.repository || "").trim();
        const branch = (e.branch || "").trim();
        const baseFolder = (e.folder || "").trim();

        if (!repository) {
          if (branch) {
            return "Branch requires a repository.";
          }
          return folderErrors[idx] || "";
        }
        if (!baseFolder) {
          return "Base folder is required when repository is set.";
        }
        if (!branch) {
          return "Branch is required when repository is set.";
        }
        return folderErrors[idx] || "";
      }

      function updateRowValidation(idx) {
        const errEl = document.querySelector('[data-folder-error="' + idx + '"]');
        const message = rowValidationMessage(idx);
        if (errEl) errEl.textContent = message;
        return !message;
      }

      function updateActionState() {
        const saveButton = document.getElementById("save");
        const applyButton = document.getElementById("apply");
        let valid = true;
        entries.forEach((e, idx) => {
          const repository = (e.repository || "").trim();
          const branch = (e.branch || "").trim();
          const baseFolder = (e.folder || "").trim();
          const message = rowValidationMessage(idx);
          const isBlank = !repository && !branch && !baseFolder;
          if (!isBlank && !!message) {
            valid = false;
          }
          updateRowValidation(idx);
        });
        saveButton.disabled = !valid;
        applyButton.disabled = !valid;
      }

      function render() {
        const tbody = document.getElementById("rows");
        tbody.innerHTML = "";
        entries.forEach((e, i) => {
          const manual = !(e.repository || "").trim();
          const repoFolder = manual ? "" : repoFolderFromRepository(e.repository || "");
          const branchFolder = manual ? "" : branchFolderFromBranch(e.branch || "");
          const tr = document.createElement("tr");
          tr.innerHTML =
            '<td class="repository-cell">' +
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
            '<td class="base-cell">' +
              '<div class="folder-cell">' +
                '<input type="text" data-field="folder" data-index="' + i + '" value="' + h(e.folder || "") + '" placeholder="' + (manual ? 'folder you maintain yourself' : '(required base folder)') + '" />' +
                '<button class="secondary" data-browse="' + i + '">…</button>' +
              '</div>' +
              '<div class="error" data-folder-error="' + i + '"></div>' +
            '</td>' +
            '<td class="repo-cell">' +
              '<input type="text" data-repo-folder="' + i + '" value="' + h(repoFolder) + '" readonly />' +
            '</td>' +
            '<td class="derived-cell">' +
              '<input type="text" data-branch-folder="' + i + '" value="' + h(branchFolder) + '" readonly />' +
            '</td>' +
            '<td class="checkbox-cell">' +
              '<input type="checkbox" data-field="enabled" data-index="' + i + '" ' + (e.enabled ? "checked" : "") + ' />' +
            '</td>' +
            '<td class="actions-cell">' +
              '<button class="secondary" data-branches="' + i + '"' + (manual ? ' disabled' : '') + '>Refresh</button>' +
              '<button class="row-remove" data-remove="' + i + '">Remove</button>' +
            '</td>';
          tbody.appendChild(tr);
        });

        entries.forEach((_, i) => {
          setDerivedFolders(i);
          updateRowValidation(i);
        });
        updateActionState();
      }

      function addSourceRow() {
        entries.push({ repository: "", branch: "", folder: "", enabled: false });
        render();
        const idx = entries.length - 1;
        const repoInput = document.querySelector('input[data-field="repository"][data-index="' + idx + '"]');
        if (repoInput) repoInput.focus();
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
        if (folderInput) {
          folderInput.placeholder = manual
            ? 'folder you maintain yourself'
            : '(required base folder)';
        }
        setDerivedFolders(idx);
        updateActionState();
      }

      function handleFieldUpdate(t) {
        const field = t.getAttribute("data-field");
        if (field === null) return;
        const idx = parseInt(t.getAttribute("data-index"), 10);
        if (field === "enabled") {
          entries[idx].enabled = t.checked;
        } else {
          entries[idx][field] = t.value;
        }

        if (field === "repository") {
          if (!(entries[idx].repository || "").trim()) {
            entries[idx].branch = "";
            folderErrors[idx] = "";
          } else {
            ensureBaseFolder(idx);
            requestBranches(idx, false);
          }
          updateRowManualState(idx);
          postValidateFolder(idx);
        }

        if (field === "branch") {
          ensureBaseFolder(idx);
          setDerivedFolders(idx);
          postValidateFolder(idx);
        }

        if (field === "folder") {
          const repository = (entries[idx].repository || "").trim();
          if (repository && !(entries[idx].folder || "").trim()) {
            ensureBaseFolder(idx);
            return;
          }
          postValidateFolder(idx);
        }

        updateActionState();
      }

      document.addEventListener("input", (ev) => {
        const t = ev.target;
        if (!t || typeof t.getAttribute !== "function") return;
        handleFieldUpdate(t);
      });

      document.addEventListener("change", (ev) => {
        const t = ev.target;
        if (!t || typeof t.getAttribute !== "function") return;
        handleFieldUpdate(t);
      });

      document.addEventListener("click", (ev) => {
        const rawTarget = ev.target;
        const el = rawTarget instanceof Element
          ? rawTarget
          : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
        if (!el) return;

        // Add source is bound via a direct onclick handler further below to
        // guarantee a single insertion; do NOT also handle it here or the
        // bubbled click will insert a second row.
        const browseBtn = el.closest("[data-browse]");
        if (browseBtn) {
          const idx = parseInt(browseBtn.getAttribute("data-browse"), 10);
          vscode.postMessage({
            type: "browseFolder",
            index: idx,
            url: entries[idx].repository,
            branch: entries[idx].branch,
            folder: entries[idx].folder,
          });
          return;
        }

        const branchBtn = el.closest("[data-branches]");
        if (branchBtn) {
          const idx = parseInt(branchBtn.getAttribute("data-branches"), 10);
          ensureBaseFolder(idx);
          requestBranches(idx, true);
          return;
        }

        const removeBtn = el.closest("[data-remove]");
        if (removeBtn) {
          const idx = parseInt(removeBtn.getAttribute("data-remove"), 10);
          entries.splice(idx, 1);
          delete folderErrors[idx];
          render();
        }
      });

      const addButton = document.getElementById("add");
      if (addButton) {
        addButton.onclick = function (ev) {
          if (ev) ev.preventDefault();
          try {
            addSourceRow();
          } catch (err) {
            const h1 = document.querySelector("h1");
            if (h1) h1.textContent = "Add failed: " + (err && err.message ? err.message : err);
          }
        };
      }
      document.getElementById("save").addEventListener("click", () => {
        if (document.getElementById("save").disabled) return;
        vscode.postMessage({ type: "save", entries: entries });
      });
      document.getElementById("apply").addEventListener("click", () => {
        if (document.getElementById("apply").disabled) return;
        vscode.postMessage({ type: "apply", entries: entries });
      });

      window.addEventListener("message", (ev) => {
        const m = ev.data;
        if (m.type === "state") {
          entries = (m.entries || []).map((e) => ({ repository: e.repository || "", branch: e.branch || "", folder: e.folder || "", enabled: !!e.enabled }));
          Object.keys(folderErrors).forEach((key) => delete folderErrors[key]);
          render();
          entries.forEach((e, idx) => {
            if ((e.repository || "").trim()) {
              requestBranches(idx, false);
              postValidateFolder(idx);
            }
          });
        } else if (m.type === "branches") {
          const idx = m.index;
          const status = document.querySelector('[data-branch-status="' + idx + '"]');
          const select = document.querySelector('select[data-field="branch"][data-index="' + idx + '"]');
          if (m.error) {
            if (status) {
              status.className = "error";
              status.textContent = m.error;
            }
            return;
          }
          if (status) status.textContent = "";
          if (select) {
            const current = entries[idx].branch;
            const options = ['<option value="">(pick a branch)</option>'];
            (m.branches || []).forEach((b) => {
              options.push('<option value="' + h(b) + '"' + (b === current ? ' selected' : '') + '>' + h(b) + '</option>');
            });
            select.innerHTML = options.join("");
          }
        } else if (m.type === "folderSuggested") {
          if (!(entries[m.index].folder || "").trim()) {
            entries[m.index].folder = m.folder;
            const input = document.querySelector('input[data-field="folder"][data-index="' + m.index + '"]');
            if (input) input.value = m.folder;
          }
          setDerivedFolders(m.index);
          postValidateFolder(m.index);
          updateActionState();
        } else if (m.type === "folderPicked") {
          entries[m.index].folder = m.folder;
          const input = document.querySelector('input[data-field="folder"][data-index="' + m.index + '"]');
          if (input) input.value = m.folder;
          folderErrors[m.index] = m.valid ? "" : (m.reason || "");
          updateActionState();
        } else if (m.type === "folderValidated") {
          folderErrors[m.index] = m.valid ? "" : (m.reason || "");
          updateActionState();
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
