import * as vscode from "vscode";
import { listRemoteBranches } from "../alBaseCode";
import {
  findDuplicateIds,
  getCustomLayers,
  LAYER_ID_PATTERN,
  saveCustomLayers,
  validateEntry,
} from "../bcquality/settings";
import {
  computeReservedNamespaces,
  isLayerIdReserved,
} from "../bcquality/namespace";
import { readProvenance } from "../bcquality/storage";
import { syncCustomLayers } from "../bcquality/sync";
import { ICustomLayerEntry } from "../bcquality/types";

/**
 * Webview panel presenting the BCQuality Custom Layers as an editable table
 * (Id · Name · Repository · Ref · Enabled · Status), with:
 *   - A live branch picker per row (git ls-remote against the fork).
 *   - Structural validation (id pattern, reserved-namespace guard, dup ids).
 *   - Save & Sync action that runs the same interactive syncCustomLayers as
 *     the `acdc.syncBcqualityCustomLayers` command.
 */
export class BcqualityCustomLayersPanel {
  private static current: BcqualityCustomLayersPanel | undefined;

  static show(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
  ): void {
    if (BcqualityCustomLayersPanel.current) {
      // Fully rebuild HTML so recent script/UI changes take effect if the panel
      // was previously opened this session (webviews cache initial HTML under
      // retainContextWhenHidden).
      BcqualityCustomLayersPanel.current.reloadWebview();
      BcqualityCustomLayersPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void BcqualityCustomLayersPanel.current.postState();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "acdcBcqualityCustomLayersPanel",
      "BCQuality Custom Layers",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    BcqualityCustomLayersPanel.current = new BcqualityCustomLayersPanel(
      panel,
      context,
      output
    );
  }

  private reloadWebview(): void {
    this.panel.webview.html = this.getHtml();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.panel.onDidDispose(() => {
      BcqualityCustomLayersPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    this.panel.webview.html = this.getHtml();
  }

  private async postState(): Promise<void> {
    const entries = getCustomLayers();
    const statuses = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.id) {
          return { id: "", installed: false };
        }
        const prov = await readProvenance(this.context, entry.id);
        if (!prov) {
          return { id: entry.id, installed: false };
        }
        return {
          id: entry.id,
          installed: true,
          sha: prov.sha,
          syncedAt: prov.syncedAt,
          instructionsCount: prov.instructionsCount,
          skillsCount: prov.skillsCount,
        };
      })
    );
    void this.panel.webview.postMessage({
      type: "state",
      entries,
      statuses,
    });
  }

  /**
   * Structural validation of the whole table. Returns human-readable errors
   * (row-anchored) so the Save/Sync buttons can gate on them without a modal.
   */
  private validateEntries(entries: ICustomLayerEntry[]): string[] {
    const errors: string[] = [];
    const reserved = computeReservedNamespaces(this.context.extensionUri);
    entries.forEach((entry, index) => {
      const row = index + 1;
      // Blank-row skip: unchanged empty rows are dropped on save, don't warn.
      if (!entry.id && !entry.repository && !entry.name && !entry.ref) {
        return;
      }
      const structural = validateEntry(entry);
      if (!structural.ok) {
        errors.push(`Row ${row}: ${structural.reason}`);
        return;
      }
      if (isLayerIdReserved(entry.id, reserved)) {
        errors.push(
          `Row ${row}: id "${entry.id}" collides with a bundled agent/skill namespace.`
        );
      }
    });
    const dupes = findDuplicateIds(entries);
    for (const id of dupes) {
      errors.push(`Duplicate layer id "${id}" — ids must be unique.`);
    }
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
      entries?: ICustomLayerEntry[];
    };

    switch (msg.type) {
      case "ready":
        await this.postState();
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

      case "save": {
        const entries = this.dropBlankRows(msg.entries ?? []);
        const errors = this.validateEntries(entries);
        if (errors.length > 0) {
          vscode.window.showWarningMessage(
            `Cannot save BCQuality Custom Layers: ${errors[0]}`
          );
          return;
        }
        await saveCustomLayers(entries);
        vscode.window.showInformationMessage("BCQuality Custom Layers saved.");
        await this.postState();
        break;
      }

      case "apply": {
        const entries = this.dropBlankRows(msg.entries ?? []);
        const errors = this.validateEntries(entries);
        if (errors.length > 0) {
          vscode.window.showWarningMessage(
            `Cannot sync BCQuality Custom Layers: ${errors[0]}`
          );
          return;
        }
        await saveCustomLayers(entries);
        const results = await syncCustomLayers(this.context, this.output, {
          promptOnFirstInstall: true,
        });
        const installed = results.filter((r) => r.outcome === "installed").length;
        const upToDate = results.filter((r) => r.outcome === "up-to-date").length;
        const declined = results.filter((r) => r.outcome === "declined").length;
        const syncErrors = results.filter((r) => r.outcome === "error").length;
        if (syncErrors > 0) {
          vscode.window.showWarningMessage(
            `BCQuality Custom Layers: ${syncErrors} error(s). Check the AC⚡DC output.`
          );
        } else if (installed === 0 && upToDate === 0 && declined === 0) {
          vscode.window.showInformationMessage(
            `BCQuality Custom Layers saved — no enabled layers to sync.`
          );
        } else {
          vscode.window.showInformationMessage(
            `BCQuality Custom Layers applied: ${installed} installed, ${upToDate} up-to-date, ${declined} declined.`
          );
        }
        await this.postState();
        break;
      }
    }
  }

  /** Drops fully-blank rows so users can leave an empty scratch row behind. */
  private dropBlankRows(entries: ICustomLayerEntry[]): ICustomLayerEntry[] {
    return entries.filter(
      (e) =>
        (e.id ?? "").trim() !== "" ||
        (e.name ?? "").trim() !== "" ||
        (e.repository ?? "").trim() !== "" ||
        (e.ref ?? "").trim() !== ""
    );
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
    <title>BCQuality Custom Layers</title>
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
      code { font-family: var(--vscode-editor-font-family, monospace); }
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
      .toolbar { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
      .toolbar .spacer { flex: 1; }
      .error { color: var(--vscode-errorForeground, #f14c4c); font-size: 0.85em; margin-top: 2px; }
      .status-cell { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
      .status-cell .installed { color: var(--vscode-testing-iconPassed, #73c991); }
      .checkbox-cell { text-align: center; }
      .id-cell { width: 12%; }
      .name-cell { width: 14%; }
      .repository-cell { width: 26%; }
      .ref-cell { width: 14%; }
      .token-cell { width: 12%; }
      .enabled-cell { width: 6%; }
      .status-col { width: 10%; }
      .actions-cell { white-space: nowrap; width: 6%; }
      .loading { font-style: italic; font-size: 0.85em; }
    </style>
  </head>
  <body>
    <h1>BCQuality Custom Layers</h1>
    <p class="hint">
      Customer/partner BCQuality forks synced into this extension's <b>globalStorage</b>
      (nothing is written into your AL workspace). Every imported rule and skill is
      prefixed with <code>&lt;id&gt;__</code> so it cannot shadow a bundled name.
      Use <b>Save</b> to persist your table, <b>Save &amp; Sync</b> to also clone/update every
      enabled layer. First-time installs ask for consent per layer.
    </p>
    <table>
      <colgroup>
        <col style="width:12%" />
        <col style="width:14%" />
        <col style="width:26%" />
        <col style="width:14%" />
        <col style="width:12%" />
        <col style="width:6%" />
        <col style="width:10%" />
        <col style="width:6%" />
      </colgroup>
      <thead>
        <tr>
          <th class="id-cell">Id</th>
          <th class="name-cell">Name</th>
          <th class="repository-cell">Repository</th>
          <th class="ref-cell">Ref (branch/tag/SHA)</th>
          <th class="token-cell">Token secret key</th>
          <th class="enabled-cell">Enabled</th>
          <th class="status-col">Status</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="toolbar">
      <button id="add" type="button" class="secondary">+ Add layer</button>
      <div class="spacer"></div>
      <button id="save" type="button" class="secondary">Save</button>
      <button id="apply" type="button">Save &amp; Sync</button>
    </div>

    <script nonce="${nonce}">
      window.onerror = function (message, source, lineno, colno) {
        try {
          const h1 = document.querySelector("h1");
          if (h1) {
            h1.style.color = "var(--vscode-errorForeground,#f14c4c)";
            h1.textContent = "BCQuality Custom Layers (script error): " + message + " @ " + lineno + ":" + colno;
          }
        } catch (e) { /* ignore */ }
        return false;
      };

      const vscode = acquireVsCodeApi();
      const LAYER_ID_RE = ${LAYER_ID_PATTERN.toString()};
      let entries = [];
      let statuses = [];
      const idErrors = {};
      const branchLoadTimers = {};

      function h(html) {
        return String(html)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function rowValidationMessage(idx) {
        const e = entries[idx];
        const id = (e.id || "").trim();
        const repository = (e.repository || "").trim();
        const blank = !id && !repository && !(e.name || "").trim() && !(e.ref || "").trim();
        if (blank) return "";
        if (!id) return "Id is required.";
        if (!LAYER_ID_RE.test(id)) return "Id must match " + LAYER_ID_RE.source + ".";
        if (!repository) return "Repository URL is required.";
        // Duplicate id check across the whole table.
        const seenAt = entries.findIndex((other, otherIdx) =>
          otherIdx < idx && ((other.id || "").trim().toLowerCase() === id.toLowerCase())
        );
        if (seenAt !== -1) return 'Duplicate id "' + id + '" (also row ' + (seenAt + 1) + ').';
        return idErrors[idx] || "";
      }

      function updateRowValidation(idx) {
        const errEl = document.querySelector('[data-row-error="' + idx + '"]');
        if (errEl) errEl.textContent = rowValidationMessage(idx);
      }

      function updateActionState() {
        const saveButton = document.getElementById("save");
        const applyButton = document.getElementById("apply");
        let valid = true;
        entries.forEach((_, idx) => {
          if (rowValidationMessage(idx)) valid = false;
          updateRowValidation(idx);
        });
        if (saveButton) saveButton.disabled = !valid;
        if (applyButton) applyButton.disabled = !valid;
      }

      function statusTextForRow(idx) {
        const id = (entries[idx].id || "").trim().toLowerCase();
        if (!id) return "(unsaved)";
        const st = statuses.find((s) => s && s.id === id);
        if (!st || !st.installed) return "(not installed)";
        const sha = (st.sha || "").slice(0, 8);
        const parts = [sha];
        if (typeof st.instructionsCount === "number") {
          parts.push(st.instructionsCount + " rule(s)");
        }
        if (typeof st.skillsCount === "number" && st.skillsCount > 0) {
          parts.push(st.skillsCount + " skill(s)");
        }
        return parts.join(" \u00b7 ");
      }

      function requestBranches(idx, immediate) {
        const repository = (entries[idx].repository || "").trim();
        const status = document.querySelector('[data-branch-status="' + idx + '"]');
        if (!repository) {
          if (status) status.textContent = "";
          return;
        }
        if (branchLoadTimers[idx]) clearTimeout(branchLoadTimers[idx]);
        const run = () => {
          if (status) {
            status.className = "loading";
            status.textContent = "Loading branches\u2026";
          }
          vscode.postMessage({ type: "listBranches", index: idx, url: repository });
        };
        if (immediate) {
          run();
        } else {
          branchLoadTimers[idx] = setTimeout(run, 350);
        }
      }

      function refDropdownHtml(idx, branches, currentRef) {
        const options = ['<option value="">(main)</option>'];
        const known = new Set(branches || []);
        const current = (currentRef || "").trim();
        (branches || []).forEach((b) => {
          options.push('<option value="' + h(b) + '"' + (b === current ? ' selected' : '') + '>' + h(b) + '</option>');
        });
        if (current && !known.has(current)) {
          options.push('<option value="' + h(current) + '" selected>' + h(current) + ' (custom)</option>');
        }
        return options.join("");
      }

      function render() {
        const tbody = document.getElementById("rows");
        tbody.innerHTML = "";
        entries.forEach((e, i) => {
          const tr = document.createElement("tr");
          const statusText = statusTextForRow(i);
          const statusInstalled = /not installed|unsaved/i.test(statusText) ? "" : "installed";
          tr.innerHTML =
            '<td class="id-cell">' +
              '<input type="text" data-field="id" data-index="' + i + '" value="' + h(e.id || "") + '" placeholder="short-id" />' +
            '</td>' +
            '<td class="name-cell">' +
              '<input type="text" data-field="name" data-index="' + i + '" value="' + h(e.name || "") + '" placeholder="(defaults to id)" />' +
            '</td>' +
            '<td class="repository-cell">' +
              '<input type="text" data-field="repository" data-index="' + i + '" value="' + h(e.repository || "") + '" placeholder="https://github.com/org/bcquality-fork.git" />' +
              '<div class="error" data-row-error="' + i + '"></div>' +
            '</td>' +
            '<td class="ref-cell">' +
              '<select data-field="ref" data-index="' + i + '">' +
                refDropdownHtml(i, [], e.ref) +
              '</select>' +
              '<div class="loading" data-branch-status="' + i + '"></div>' +
            '</td>' +
            '<td class="token-cell">' +
              '<input type="text" data-field="tokenSecretKey" data-index="' + i + '" value="' + h(e.tokenSecretKey || "") + '" placeholder="(public fork \u2192 leave empty)" />' +
            '</td>' +
            '<td class="checkbox-cell enabled-cell">' +
              '<input type="checkbox" data-field="enabled" data-index="' + i + '" ' + (e.enabled ? "checked" : "") + ' />' +
            '</td>' +
            '<td class="status-cell status-col ' + statusInstalled + '" data-status-cell="' + i + '">' +
              h(statusText) +
            '</td>' +
            '<td class="actions-cell">' +
              '<button class="secondary" data-branches="' + i + '">Refresh</button>' +
              '<button class="row-remove" data-remove="' + i + '">Remove</button>' +
            '</td>';
          tbody.appendChild(tr);
        });
        entries.forEach((e, idx) => {
          if ((e.repository || "").trim()) {
            requestBranches(idx, false);
          }
          updateRowValidation(idx);
        });
        updateActionState();
      }

      function addRow() {
        entries.push({ id: "", name: "", repository: "", ref: "", tokenSecretKey: "", enabled: false });
        render();
        const idx = entries.length - 1;
        const first = document.querySelector('input[data-field="id"][data-index="' + idx + '"]');
        if (first) first.focus();
      }

      function handleFieldUpdate(t) {
        const field = t.getAttribute("data-field");
        if (field === null) return;
        const idx = parseInt(t.getAttribute("data-index"), 10);
        if (Number.isNaN(idx) || !entries[idx]) return;
        if (field === "enabled") {
          entries[idx].enabled = t.checked;
        } else if (field === "id") {
          entries[idx].id = (t.value || "").toLowerCase();
          t.value = entries[idx].id;
        } else {
          entries[idx][field] = t.value;
        }
        if (field === "repository") {
          requestBranches(idx, false);
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
        const raw = ev.target;
        const el = raw instanceof Element ? raw : (raw && raw.parentElement ? raw.parentElement : null);
        if (!el) return;

        const branchBtn = el.closest("[data-branches]");
        if (branchBtn) {
          const idx = parseInt(branchBtn.getAttribute("data-branches"), 10);
          requestBranches(idx, true);
          return;
        }
        const removeBtn = el.closest("[data-remove]");
        if (removeBtn) {
          const idx = parseInt(removeBtn.getAttribute("data-remove"), 10);
          entries.splice(idx, 1);
          delete idErrors[idx];
          render();
        }
      });

      const addBtn = document.getElementById("add");
      if (addBtn) addBtn.onclick = (ev) => { if (ev) ev.preventDefault(); addRow(); };
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
          entries = (m.entries || []).map((e) => ({
            id: (e.id || "").toLowerCase(),
            name: e.name || "",
            repository: e.repository || "",
            ref: e.ref || "",
            tokenSecretKey: e.tokenSecretKey || "",
            enabled: !!e.enabled,
          }));
          statuses = m.statuses || [];
          Object.keys(idErrors).forEach((k) => delete idErrors[k]);
          render();
        } else if (m.type === "branches") {
          const idx = m.index;
          const select = document.querySelector('select[data-field="ref"][data-index="' + idx + '"]');
          const status = document.querySelector('[data-branch-status="' + idx + '"]');
          if (m.error) {
            if (status) {
              status.className = "error";
              status.textContent = m.error;
            }
            return;
          }
          if (status) {
            status.className = "loading";
            status.textContent = "";
          }
          if (select) {
            select.innerHTML = refDropdownHtml(idx, m.branches || [], entries[idx].ref);
          }
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
