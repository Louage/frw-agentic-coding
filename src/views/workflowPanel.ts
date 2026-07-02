import * as vscode from "vscode";
import {
  type AgentWorkflowHandoff,
  type AgentWorkflowViewModel,
} from "../workflows/agentWorkflowService";

interface WorkflowPanelHandlers {
  onSelectCurrentAgent: () => Promise<void>;
  onSelectHandoff: (handoff: AgentWorkflowHandoff) => Promise<void>;
  onFileDropped: (fileUri: string) => Promise<void>;
  onSelectFile: () => Promise<void>;
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
    const payload = message as { type?: string; fileUri?: string; handoffIndex?: number };
    if (!payload.type) { return; }

    if (payload.type === "selectFile") {
      await this.handlers.onSelectFile();
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
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const m = this.model;

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const incomingItems = m.incoming.length === 0
      ? `<div>No incoming routes.</div>`
      : m.incoming.map(inc =>
          `<div>${esc(inc.sourceDisplayName)} &#8594; ${esc(inc.label)}</div>`
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
          ${m.requiredTools && m.requiredTools.length > 0 ? `<div style="margin-top:10px;padding:8px;background:rgba(217,119,6,0.12);border-radius:4px;font-size:12px"><strong>Required Tools:</strong> ${m.requiredTools.map(t => esc(t)).join(", ")}</div>` : ""}
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

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
