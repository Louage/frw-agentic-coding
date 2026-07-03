import * as vscode from "vscode";
import {
  type AgentWorkflowHandoff,
  type AgentWorkflowIncomingRoute,
  type AgentWorkflowViewModel,
  type AgentWorkflowTool,
} from "../workflows/agentWorkflowService";

interface WorkflowPanelHandlers {
  onSelectCurrentAgent: () => Promise<void>;
  onSelectHandoff: (handoff: AgentWorkflowHandoff) => Promise<void>;
  onSelectIncoming: (incoming: AgentWorkflowIncomingRoute) => Promise<void>;
  onFileDropped: (fileUri: string) => Promise<void>;
  onSelectFile: () => Promise<void>;
  onRefreshTools: () => Promise<void>;
  onOpenToolsPicker: () => Promise<void>;
  onInstallTool: (toolId: string) => Promise<void>;
}

export class WorkflowPanel {
  private static currentPanel: WorkflowPanel | undefined;

  static show(model: AgentWorkflowViewModel, handlers: WorkflowPanelHandlers): void {
    if (WorkflowPanel.currentPanel) {
      WorkflowPanel.currentPanel.model = model;
      WorkflowPanel.currentPanel.handlers = handlers;
      WorkflowPanel.currentPanel.render();
      WorkflowPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "frwAgentWorkflowPanel",
      model.title,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    WorkflowPanel.currentPanel = new WorkflowPanel(panel, model, handlers);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private model: AgentWorkflowViewModel,
    private handlers: WorkflowPanelHandlers
  ) {
    this.panel.onDidDispose(() => {
      WorkflowPanel.currentPanel = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async (message: unknown) => {
      await this.handleMessage(message);
    });
    this.render();
  }

  private render(): void {
    this.panel.title = this.model.title;
    this.panel.webview.html = this.getHtml();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") { return; }
    const payload = message as { type?: string; fileUri?: string; handoffIndex?: number; incomingIndex?: number };
    if (!payload.type) { return; }

    if (payload.type === "selectFile") {
      await this.handlers.onSelectFile();
      return;
    }

    if (payload.type === "refreshTools") {
      await this.handlers.onRefreshTools();
      return;
    }

    if (payload.type === "openToolsPicker") {
      await this.handlers.onOpenToolsPicker();
      return;
    }

    if (payload.type === "installTool" && typeof (payload as { toolId?: string }).toolId === "string") {
      await this.handlers.onInstallTool((payload as { toolId: string }).toolId);
      return;
    }

    if (payload.type === "selectCurrentAgent") {
      await this.handlers.onSelectCurrentAgent();
      return;
    }
    if (payload.type === "fileDropped" && payload.fileUri) {
      await this.handlers.onFileDropped(payload.fileUri);
      return;
    }
    if (payload.type === "selectHandoff" && typeof payload.handoffIndex === "number") {
      const handoff = this.model.handoffs[payload.handoffIndex];
      if (handoff) { await this.handlers.onSelectHandoff(handoff); }
      return;
    }
    if (payload.type === "selectIncoming" && typeof payload.incomingIndex === "number") {
      const incoming = this.model.incoming[payload.incomingIndex];
      if (incoming) { await this.handlers.onSelectIncoming(incoming); }
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const m = this.model;

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const incomingItems = m.incoming.length === 0
      ? `<div>No incoming routes.</div>`
      : m.incoming.map((inc, i) =>
          `<button data-incoming="${i}" title="Agent: ${esc(inc.sourceDisplayName)}" style="text-align:left;background:none;border:none;padding:0;color:var(--vscode-editor-foreground,#ccc);cursor:pointer">${esc(inc.sourceDisplayName)} &#8594; ${esc(inc.label)}</button>`
        ).join("\n          ");

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
    <title>${esc(m.title)}</title>
    <style>
      body {
        margin: 0;
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-editor-foreground, #ccc);
        background: var(--vscode-editor-background, #1e1e1e);
      }
      .layout {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
        box-sizing: border-box;
        height: 100vh;
        overflow: hidden;
      }
      .card {
        border: 1px solid var(--vscode-panel-border, #444);
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .card:first-child {
        flex: 1;
        min-height: 300px;
      }
      .card:last-child {
        flex-shrink: 0;
        max-height: 50vh;
        overflow-y: auto;
      }
      .card-title {
        margin: 0;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 600;
        border-bottom: 1px solid var(--vscode-panel-border, #444);
        flex-shrink: 0;
      }
      .diagram {
        padding: 12px;
        flex: 1;
        overflow: auto;
        min-height: 200px;
      }
      .routing-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
        padding: 12px;
      }
      .routing-col {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }
      .hint { font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
      .list { display: flex; flex-direction: column; gap: 5px; }
      .col-sep { border-left: 1px solid var(--vscode-panel-border, #444); padding-left: 12px; }
      button {
        display: inline-block;
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
        border-radius: 4px;
        padding: 5px 10px;
        cursor: pointer;
        text-align: center;
        font-size: 12px;
        font-family: inherit;
      }
      button:hover { filter: brightness(1.1); }
      button.full-width { display: block; width: 100%; }
      #browseFile { margin-top: 6px; }
      details { margin-top: 8px; }
      summary { cursor: pointer; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
      pre {
        font-size: 11px;
        overflow: auto;
        max-height: 160px;
        padding: 6px;
        border: 1px solid var(--vscode-panel-border, #444);
        border-radius: 4px;
        margin: 4px 0;
        background: var(--vscode-textCodeBlock-background, #252526);
        white-space: pre-wrap;
        word-break: break-all;
      }
      @keyframes working {
        0%, 100% { stroke: #115e59; stroke-width: 1.5; }
        50%       { stroke: #5eead4; stroke-width: 3; }
      }
      #active-node.working { animation: working 1.2s ease-in-out infinite; }
    </style>
  </head>
  <body>
    <div class="layout">
      <section class="card">
        <h2 class="card-title">${esc(m.title)}</h2>
        <div class="diagram">${m.svg}</div>
      </section>
      <section class="card">
        <h2 class="card-title">Agent Routing</h2>
        <div class="content">
          <div class="hint">${esc(m.description)}</div>
          <button id="browseFile">Upload file…</button>
          ${m.bcReviewSpecialist ? `<div style="margin-top:10px;padding:8px;background:rgba(15,118,110,0.1);border-radius:4px;font-size:12px"><strong>Review with:</strong> ${esc(m.bcReviewSpecialist)}</div>` : ""}
          ${renderRequiredRequirements("Required Tools", m.requiredTools, esc, "tools")}
          ${renderRequiredRequirements("Required MCP Servers", m.requiredMcpServers, esc, "mcp")}
          <div class="incoming">
            <strong>Incoming routes</strong>
            <div class="list hint" style="margin-top:5px">
              ${incomingItems}
            </div>
          </div>
        </div>
      </section>
    </div>
    <script nonce="${nonce}">
      var vscode = acquireVsCodeApi();

      var workingTimer;
      function setWorking() {
        var node = document.getElementById("active-node");
        if (!node) { return; }
        node.classList.add("working");
        clearTimeout(workingTimer);
        workingTimer = setTimeout(function() { node.classList.remove("working"); }, 60000);
      }

      document.getElementById("browseFile").addEventListener("click", function() {
        setWorking();
        vscode.postMessage({ type: "selectFile" });
      });

      document.querySelectorAll(".refresh-requirements").forEach(function(btn) {
        btn.addEventListener("click", function() {
          vscode.postMessage({ type: "refreshTools" });
        });
      });

      document.querySelectorAll(".tool-unavailable").forEach(function(btn) {
        btn.addEventListener("click", function() {
          vscode.postMessage({ type: "openToolsPicker" });
        });
      });

      document.querySelectorAll(".tool-install").forEach(function(btn) {
        btn.addEventListener("click", function() {
          vscode.postMessage({ type: "installTool", toolId: btn.getAttribute("data-tool-id") });
        });
      });

      document.querySelectorAll("[data-incoming]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          vscode.postMessage({ type: "selectIncoming", incomingIndex: parseInt(btn.getAttribute("data-incoming"), 10) });
        });
      });

      document.querySelectorAll(".nav-handoff").forEach(function(el) {
        el.addEventListener("click", function() {
          var idx = parseInt(el.getAttribute("data-handoff-index"), 10);
          if (!isNaN(idx)) {
            vscode.postMessage({ type: "selectHandoff", handoffIndex: idx });
          }
        });
      });

      document.querySelectorAll(".nav-incoming").forEach(function(el) {
        el.addEventListener("click", function() {
          var idx = parseInt(el.getAttribute("data-incoming-index"), 10);
          if (!isNaN(idx)) {
            vscode.postMessage({ type: "selectIncoming", incomingIndex: idx });
          }
        });
      });

      function normalizeUri(p) {
        if (!p || p.startsWith("file://")) { return p || ""; }
        var n = p.replace(/\\\\/g, "/");
        return /^[A-Za-z]:\\//.test(n) ? "file:///" + n : "file://" + n;
      }
    </script>
  </body>
</html>`;
  }
}

function renderRequiredRequirements(
  title: string,
  requirements: AgentWorkflowTool[] | undefined,
  esc: (s: string) => string,
  kind: "tools" | "mcp"
): string {
  if (!requirements || requirements.length === 0) { return ""; }

  const activeTools = requirements.filter((t) => !t.deprecated);
  const deprecatedTools = requirements.filter((t) => t.deprecated);
  const allAvailable = activeTools.every((t) => t.available);
  const anyUnavailable = activeTools.some((t) => !t.available);

  const headerColor = allAvailable
    ? "rgba(15,118,110,0.12)"
    : anyUnavailable ? "rgba(220,38,38,0.12)" : "rgba(217,119,6,0.12)";

  const chips = activeTools.map((t) => {
    const icon = t.available ? "\u2713" : "\u2717";
    const color = t.available ? "#6fbf73" : "#f48482";
    if (t.available) {
      return `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px;padding:2px 6px;border-radius:10px;background:rgba(0,0,0,0.2);font-size:11px;white-space:nowrap">` +
        `<span style="color:${color};font-weight:700">${icon}</span>${esc(t.id)}` +
        `</span>`;
    }
    // Unavailable chip — always clickable to open picker
    const title = t.suggestion
      ? esc(t.suggestion.description)
      : "Click to open tool selector";
    return `<button class="tool-unavailable" title="${title}" ` +
      `style="display:inline-flex;align-items:center;gap:3px;margin:2px;padding:2px 6px;border-radius:10px;background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.4);font-size:11px;white-space:nowrap;cursor:pointer;color:inherit">` +
      `<span style="color:${color};font-weight:700">${icon}</span>${esc(t.id)}` +
      `</button>`;
  }).join("");

  // Suggestion cards for unavailable (non-deprecated) tools
  const suggestions = activeTools
    .filter((t) => !t.available && t.suggestion)
    .map((t) => {
      const s = t.suggestion!;
      const actionBtn = s.type === "vscode-extension" && s.extensionId
        ? `<button class="tool-install" data-tool-id="${esc(s.extensionId)}" ` +
          `style="margin-top:4px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:3px;padding:2px 8px;font-size:10px;cursor:pointer">` +
          `Install ${esc(s.extensionName ?? s.extensionId)}</button>`
        : s.type === "mcp-server" && s.mcpConfig
          ? `<div style="margin-top:4px;font-size:10px;color:var(--vscode-descriptionForeground,#888)">Add to mcp.json:</div>` +
            `<pre style="font-size:9px;margin:2px 0 0;padding:4px;background:rgba(0,0,0,0.3);border-radius:3px;overflow:auto;user-select:text">${esc(s.mcpConfig)}</pre>`
          : "";

      return `<div style="margin-top:8px;padding:6px;background:rgba(0,0,0,0.2);border-radius:4px;border-left:2px solid #f48482">` +
        `<div style="font-size:10px;font-weight:600;color:#f48482">${esc(t.id)}</div>` +
        `<div style="font-size:10px;margin-top:2px">${esc(s.description)}</div>` +
        actionBtn +
        `</div>`;
    }).join("");

  const deprecatedChips = deprecatedTools.length === 0 ? "" :
    `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:2px;align-items:center">` +
    `<span style="font-size:10px;color:var(--vscode-descriptionForeground,#888);margin-right:4px">Deprecated (removed on next sync):</span>` +
    deprecatedTools.map((t) =>
      `<span title="${esc(t.suggestion?.description ?? "Deprecated tool")}" ` +
      `style="display:inline-flex;align-items:center;gap:2px;margin:1px;padding:1px 5px;border-radius:10px;background:rgba(0,0,0,0.1);font-size:10px;white-space:nowrap;color:var(--vscode-descriptionForeground,#888);text-decoration:line-through">` +
      `${esc(t.id)}</span>`
    ).join("") +
    `</div>`;

  return `<div style="margin-top:10px;padding:8px;background:${headerColor};border-radius:4px;font-size:12px">` +
    `<div style="display:flex;align-items:center;justify-content:space-between">` +
    `<strong>${esc(title)}:</strong>` +
    `<button class="refresh-requirements" title="Refresh ${esc(title).toLowerCase()} availability" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:14px;color:var(--vscode-descriptionForeground,#888)">&#x21BA;</button>` +
    `</div>` +
    `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:2px">${chips}</div>` +
    (anyUnavailable ? `<div style="margin-top:4px;font-size:10px;color:var(--vscode-descriptionForeground,#888)">Click \u2717 to open tool selector${kind === "mcp" ? " or configure mcp.json" : ""}</div>` : "") +
    suggestions +
    deprecatedChips +
    `</div>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
