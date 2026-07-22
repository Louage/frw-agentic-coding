import * as vscode from "vscode";
import {
  getAgentSettingsViewModel,
  resetAgentSettingEntry,
  saveAgentSettingEntry,
  savePlaceholderRows,
} from "../agentSettingsService";

export class AgentSettingsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "acdc.agentSettings";

  private view: vscode.WebviewView | undefined;
  private selectedAgentId: string | undefined;
  private selectedAgentName: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async selectAgent(displayName: string, stableId?: string): Promise<void> {
    this.selectedAgentName = displayName;
    this.selectedAgentId = stableId;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.buildState();
    await this.view.webview.postMessage({ type: "state", state });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((message) => void this.handleMessage(message));
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
    void this.refresh();
  }

  private async buildState(): Promise<Record<string, unknown>> {
    const state = await getAgentSettingsViewModel(
      this.context.extensionUri,
      this.selectedAgentId
    );
    this.selectedAgentId = this.selectedAgentId ?? state.selected.fileId;
    this.selectedAgentName = this.selectedAgentName ?? state.selected.name;
    return {
      selectedAgentId: this.selectedAgentId,
      selectedAgentName: this.selectedAgentName,
      selectedPlaceholder: state.selectedPlaceholder,
      agents: state.agents.map((agent) => ({
        stableId: agent.fileId,
        displayName: agent.name,
      })),
      reviewAgents: state.allAgents.map((agent) => ({
        stableId: agent.fileId,
        displayName: agent.name,
      })),
      availableModels: state.availableModels.map((model) => ({
        id: model.id,
        name: model.name,
        detail: model.family ?? "",
        tooltip: model.version ?? "",
      })),
      selected: {
        fileId: state.selected.fileId,
        name: state.selected.name,
        description: state.selected.description ?? "",
        model: state.selected.effectiveModel ?? "",
        argumentHint: state.selected.effectiveArgumentHint ?? "",
        bcReviewSpecialist: state.selected.effectiveBcReviewSpecialist ?? "",
        handoffs: state.selected.effectiveHandoffs,
      },
      modelHint:
        state.availableModels.length > 0
          ? "Pick from the available Copilot models or type a custom value."
          : "No Copilot models were reported by the host; type a model name manually.",
    };
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }

    const msg = message as {
      type?: string;
      agentId?: string;
      entry?: {
        model?: string;
        argumentHint?: string;
        bcReviewSpecialist?: string;
        handoffs?: Array<{ label: string; agent: string; prompt?: string }>;
      };
      rows?: Array<{ key: string; target: string }>;
    };

    switch (msg.type) {
      case "ready":
        await this.refresh();
        break;

      case "selectAgent":
        if (msg.agentId) {
          this.selectedAgentId = msg.agentId;
        }
        await this.refresh();
        break;

      case "saveAgent":
        if (!this.selectedAgentId || !msg.entry) {
          return;
        }
        await saveAgentSettingEntry(this.selectedAgentId, {
          model: msg.entry.model?.trim() ?? "",
          argumentHint: msg.entry.argumentHint?.trim() ?? "",
          bcReviewSpecialist: msg.entry.bcReviewSpecialist?.trim() ?? "",
          handoffs: msg.entry.handoffs ?? [],
        });
        break;

      case "resetAgent":
        if (!this.selectedAgentId) {
          return;
        }
        await resetAgentSettingEntry(this.selectedAgentId);
        await this.refresh();
        break;

      case "savePlaceholders":
        await savePlaceholderRows(msg.rows ?? []);
        await this.refresh();
        break;

      case "applyToChat":
        await vscode.commands.executeCommand("acdc.applyAgentSettingsToChat", {
          autoReload: true,
          promptReload: false,
          silentNoChanges: false,
        });
        break;
    }
  }

  private getHtml(_webview: vscode.Webview): string {
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
    <title>Agent Settings</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --panel: var(--vscode-editor-background);
        --text: var(--vscode-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-panel-border, rgba(255,255,255,0.08));
        --accent: var(--vscode-button-background);
        --accent-fg: var(--vscode-button-foreground);
        --accent-2: var(--vscode-button-secondaryBackground);
        --danger: var(--vscode-errorForeground);
      }
      body {
        margin: 0;
        padding: 12px;
        font-family: var(--vscode-font-family);
        color: var(--text);
        background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 95%, transparent), var(--bg));
      }
      h1, h2, h3 { margin: 0; }
      h1 { font-size: 1.05rem; }
      h2 { font-size: 0.95rem; margin-bottom: 8px; }
      .card {
        background: color-mix(in srgb, var(--panel) 92%, transparent);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 12px;
      }
      .agent-header-card {
        padding: 10px 12px 10px;
      }
      .agent-header-card .header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .agent-header-card .placeholder-inline {
        display: grid;
        grid-template-columns: 1fr 1.2fr;
        gap: 8px;
        margin-top: 10px;
      }
      .agent-header-card #selected-agent-name {
        margin: 0;
        line-height: 1.25;
        font-weight: 600;
      }
      .subtle { color: var(--muted); font-size: 0.85rem; }
      .row { display: grid; gap: 8px; margin-bottom: 10px; }
      .stack { display: grid; gap: 10px; }
      label { font-size: 0.82rem; font-weight: 600; display: block; margin-bottom: 4px; }
      input[type="text"], textarea, select {
        width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--border);
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        padding: 6px 8px; font: inherit;
      }
      textarea { min-height: 88px; resize: vertical; }
      select.picker {
        appearance: none;
        padding-right: 30px;
        background-image:
          linear-gradient(45deg, transparent 50%, var(--muted) 50%),
          linear-gradient(135deg, var(--muted) 50%, transparent 50%);
        background-position:
          calc(100% - 16px) calc(50% - 2px),
          calc(100% - 10px) calc(50% - 2px);
        background-size: 6px 6px, 6px 6px;
        background-repeat: no-repeat;
      }
      select.picker:focus {
        outline: 1px solid var(--accent);
        outline-offset: 1px;
      }
      button {
        border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer;
        background: var(--accent); color: var(--accent-fg); font: inherit;
      }
      button.secondary { background: var(--accent-2); color: var(--vscode-button-secondaryForeground); }
      button.danger { background: transparent; color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); }
      button:disabled { opacity: 0.45; cursor: default; }
      .header-actions { display: flex; gap: 8px; align-items: center; }
      .apply-note { color: var(--muted); font-size: 0.76rem; margin-top: 6px; }
      .apply-note.dirty { color: var(--accent); }
      .group { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 10px; }
      .group-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
      .handoff-row { display: grid; gap: 8px; align-items: start; border: 1px solid var(--border); border-radius: 8px; padding: 8px; margin-bottom: 8px; }
      .handoff-row .handoff-top { display: grid; grid-template-columns: 1.2fr 1fr auto; gap: 8px; align-items: center; }
      .handoff-row textarea { min-height: 48px; }
      .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
      .pill { border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; font-size: 0.76rem; color: var(--muted); }
      .empty { color: var(--muted); font-style: italic; }
      .section-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <div class="card agent-header-card">
      <div class="header-row">
        <div id="selected-agent-name"></div>
        <div class="header-actions">
          <button id="reset-agent" type="button" class="secondary">Reset to defaults</button>
          <button id="apply-chat" type="button" disabled>Apply</button>
        </div>
      </div>
      <div id="apply-note" class="apply-note">No pending changes.</div>
      <div id="selected-placeholder-row" class="placeholder-inline" hidden>
        <input id="selected-placeholder-key" type="text" readonly />
        <select id="selected-placeholder-target" class="picker"></select>
      </div>
    </div>

    <div class="card" id="agent-card">
      <div class="row">
        <label for="model-input">Model</label>
        <select id="model-input" class="picker"></select>
      </div>

      <div class="stack">
        <div class="row">
          <label for="argument-hint-input">Argument hint</label>
          <textarea id="argument-hint-input" rows="4"></textarea>
        </div>
        <div class="row">
          <label for="review-specialist-input">BC review specialist</label>
          <select id="review-specialist-input" class="picker"></select>
        </div>
      </div>

      <div class="group">
        <div class="group-head">
          <h3>Handoffs</h3>
          <button id="add-handoff" type="button" class="secondary">+ Add handoff</button>
        </div>
        <div id="handoff-list"></div>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let state = null;
      let agentSaveTimer = 0;
      let dirty = false;

      function updateApplyUi() {
        const applyButton = document.getElementById('apply-chat');
        const note = document.getElementById('apply-note');
        if (applyButton) {
          applyButton.disabled = !dirty;
        }
        if (note) {
          note.textContent = dirty
            ? 'You have unsaved changes. Click Apply to update chat — this reloads the window.'
            : 'No pending changes.';
          note.classList.toggle('dirty', dirty);
        }
      }

      function markDirty() {
        dirty = true;
        updateApplyUi();
      }

      function send(type, payload = {}) {
        vscode.postMessage(Object.assign({ type }, payload));
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function normalizeModelToken(value) {
        return String(value || '')
          .trim()
          .toLowerCase()
          .replace(/\\s*\\(copilot\\)\\s*/g, ' ')
          .replace(/\\s*\\(\\s*\\)\\s*/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
      }

      function scheduleAgentSave() {
        clearTimeout(agentSaveTimer);
        agentSaveTimer = window.setTimeout(saveAgent, 150);
      }

      function saveAgent() {
        const modelInput = document.getElementById('model-input');
        const argumentHintInput = document.getElementById('argument-hint-input');
        const reviewSpecialistInput = document.getElementById('review-specialist-input');
        const handoffList = document.getElementById('handoff-list');

        const handoffEntries = Array.from(handoffList.querySelectorAll('[data-handoff-row]'))
          .map((row) => ({
            label: row.querySelector('[data-handoff-label]')?.value.trim() || '',
            agent: row.querySelector('[data-handoff-agent]')?.value.trim() || '',
            prompt: row.querySelector('[data-handoff-prompt]')?.value.trim() || '',
          }))
          .filter((handoff) => handoff.label || handoff.agent)
          .filter((handoff) => handoff.label && handoff.agent);

        send('saveAgent', {
          entry: {
            model: modelInput.value.trim(),
            argumentHint: argumentHintInput.value.trim(),
            bcReviewSpecialist: reviewSpecialistInput.value.trim(),
            handoffs: handoffEntries,
          },
        });
        markDirty();
      }

      function saveSelectedPlaceholder(key) {
        const targetSelect = document.getElementById('selected-placeholder-target');
        const target = targetSelect.value.trim();
        if (!key || !target) {
          return;
        }
        send('savePlaceholders', { rows: [{ key: key, target: target }] });
        markDirty();
      }

      function render() {
        if (!state) {
          return;
        }

        updateApplyUi();

        const selectedAgentName = document.getElementById('selected-agent-name');
        selectedAgentName.textContent = state.selectedAgentName || state.selected.name || 'No agent selected';

        const modelInput = document.getElementById('model-input');
        const argumentHintInput = document.getElementById('argument-hint-input');
        const reviewSpecialistInput = document.getElementById('review-specialist-input');
        const currentModel = state.selected.model || '';
        const currentSpecialist = state.selected.bcReviewSpecialist || '';

        const matchedModel = state.availableModels.find((model) => {
          return model.id === currentModel ||
            model.name === currentModel ||
            normalizeModelToken(model.name) === normalizeModelToken(currentModel);
        });

        const modelOptions = state.availableModels.map((model) => {
          const selected = matchedModel && model.id === matchedModel.id ? ' selected' : '';
          return '<option value="' + escapeHtml(model.id) + '"' + selected + '>' + escapeHtml(model.name) + '</option>';
        }).join('');

        const cleanedCurrentModel = String(currentModel)
          .replace(/\\s*\\(copilot\\)\\s*/gi, ' ')
          .replace(/\\s*\\(\\s*\\)\\s*/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
        const customModelOption = cleanedCurrentModel && !matchedModel
          ? '<option value="' + escapeHtml(cleanedCurrentModel) + '" selected>' + escapeHtml(cleanedCurrentModel) + '</option>'
          : '';
        modelInput.innerHTML = '<option value="">Select a Copilot model…</option>' + modelOptions + customModelOption;
        modelInput.value = matchedModel ? matchedModel.id : cleanedCurrentModel;
        modelInput.onchange = scheduleAgentSave;

        const specialistAgents = state.reviewAgents || state.agents;
        const specialistOptions = specialistAgents.map((agent) => {
          const selected = agent.displayName === currentSpecialist ? ' selected' : '';
          return '<option value="' + escapeHtml(agent.displayName) + '"' + selected + '>' + escapeHtml(agent.displayName) + '</option>';
        }).join('');
        const customSpecialistOption = currentSpecialist && !specialistAgents.some((agent) => agent.displayName === currentSpecialist)
          ? '<option value="' + escapeHtml(currentSpecialist) + '" selected>' + escapeHtml(currentSpecialist) + ' (custom)</option>'
          : '';
        reviewSpecialistInput.innerHTML = '<option value="">Select a BC review specialist…</option>' + specialistOptions + customSpecialistOption;
        reviewSpecialistInput.value = currentSpecialist;
        reviewSpecialistInput.onchange = scheduleAgentSave;

        const selectedPlaceholder = state.selectedPlaceholder;
        const placeholderRow = document.getElementById('selected-placeholder-row');
        const placeholderKeyInput = document.getElementById('selected-placeholder-key');
        const placeholderTargetSelect = document.getElementById('selected-placeholder-target');
        if (selectedPlaceholder && selectedPlaceholder.key) {
          placeholderRow.hidden = false;
          placeholderKeyInput.value = selectedPlaceholder.key;

          const defaultTarget = selectedPlaceholder.target || state.selected.name || specialistAgents[0]?.displayName || '';
          const targetOptions = specialistAgents.map((agent) => {
            const selected = agent.displayName === defaultTarget ? ' selected' : '';
            return '<option value="' + escapeHtml(agent.displayName) + '"' + selected + '>' + escapeHtml(agent.displayName) + '</option>';
          }).join('');
          const customTargetOption = defaultTarget && !specialistAgents.some((agent) => agent.displayName === defaultTarget)
            ? '<option value="' + escapeHtml(defaultTarget) + '" selected>' + escapeHtml(defaultTarget) + '</option>'
            : '';
          placeholderTargetSelect.innerHTML = customTargetOption + targetOptions;
          placeholderTargetSelect.value = defaultTarget;
          placeholderTargetSelect.onchange = () => saveSelectedPlaceholder(selectedPlaceholder.key);
        } else {
          placeholderRow.hidden = true;
          placeholderKeyInput.value = '';
          placeholderTargetSelect.innerHTML = '';
          placeholderTargetSelect.onchange = null;
        }

        argumentHintInput.value = state.selected.argumentHint || '';
        argumentHintInput.oninput = scheduleAgentSave;

        const handoffList = document.getElementById('handoff-list');
        const handoffs = state.selected.handoffs || [];
        handoffList.innerHTML = handoffs.length === 0 ? '<div class="empty">No handoffs configured.</div>' : handoffs.map((handoff, index) => {
          const agentOptions = state.agents.map((agent) => {
            const selected = agent.displayName === handoff.agent ? ' selected' : '';
            return '<option value="' + escapeHtml(agent.displayName) + '"' + selected + '>' + escapeHtml(agent.displayName) + '</option>';
          }).join('');
          return '<div class="handoff-row" data-handoff-row="' + index + '">' +
            '<div class="handoff-top">' +
            '<input type="text" data-handoff-label value="' + escapeHtml(handoff.label || '') + '" placeholder="Label" />' +
            '<select data-handoff-agent><option value="">Select target agent…</option>' + agentOptions + '</select>' +
            '<button type="button" class="danger" data-remove-handoff>Remove</button>' +
            '</div>' +
            '<textarea data-handoff-prompt rows="2" placeholder="Handoff prompt">' + escapeHtml(handoff.prompt || '') + '</textarea>' +
            '</div>';
        }).join('');

        handoffList.querySelectorAll('[data-remove-handoff]').forEach((button) => {
          button.onclick = () => {
            button.closest('[data-handoff-row]')?.remove();
            scheduleAgentSave();
          };
        });

        handoffList.querySelectorAll('[data-handoff-row] input, [data-handoff-row] select, [data-handoff-row] textarea').forEach((field) => {
          field.oninput = scheduleAgentSave;
          field.onchange = scheduleAgentSave;
        });

        document.getElementById('reset-agent').onclick = () => {
          send('resetAgent');
          markDirty();
        };
        document.getElementById('apply-chat').onclick = () => {
          send('applyToChat');
          dirty = false;
          updateApplyUi();
        };
        document.getElementById('add-handoff').onclick = () => {
          const row = document.createElement('div');
          row.className = 'handoff-row';
          row.dataset.handoffRow = String(handoffList.children.length);
          row.innerHTML = '<div class="handoff-top">' +
            '<input type="text" data-handoff-label placeholder="Label" />' +
            '<select data-handoff-agent><option value="">Select target agent…</option>' +
            state.agents.map((agent) => '<option value="' + escapeHtml(agent.displayName) + '">' + escapeHtml(agent.displayName) + '</option>').join('') +
            '</select>' +
            '<button type="button" class="danger" data-remove-handoff>Remove</button>' +
            '</div>' +
            '<textarea data-handoff-prompt rows="2" placeholder="Handoff prompt"></textarea>';
          row.querySelector('[data-remove-handoff]').onclick = () => {
            row.remove();
            scheduleAgentSave();
          };
          row.querySelectorAll('input, select, textarea').forEach((field) => {
            field.oninput = scheduleAgentSave;
            field.onchange = scheduleAgentSave;
          });
          handoffList.appendChild(row);
        };

      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message && message.type === 'state') {
          state = message.state;
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
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}
