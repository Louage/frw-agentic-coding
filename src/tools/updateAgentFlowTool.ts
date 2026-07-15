import * as vscode from "vscode";
import { FlowStateService } from "../workflows/flowStateService";

/**
 * Input parameters for the update-agent-flow tool. Must match the `inputSchema`
 * declared in package.json for `frw_update_agent_flow`.
 */
interface IUpdateAgentFlowInput {
  step?: string;
  action?: "start" | "complete" | "reset" | "handoff";
  agent?: string;
  skill?: string;
}

/**
 * Language model tool that lets the active agent report its current position
 * in its own workflow. The extension's sidebar "Agent Flow" view re-renders
 * whenever this tool is invoked so the user always sees where in the SDD /
 * orchestration flow the agent currently stands.
 *
 * Usage from an agent:
 * - Call with `{ step: "create-feature-spec", action: "start" }` when starting a step.
 * - Call with `{ action: "complete" }` when the current step is done.
 * - Call with `{ action: "reset" }` to clear the flow (e.g. new feature).
 * - Optionally pass `skill` to indicate which SKILL.md is being applied.
 */
export class UpdateAgentFlowTool
  implements vscode.LanguageModelTool<IUpdateAgentFlowInput>
{
  constructor(
    private readonly stateService: FlowStateService,
    private readonly output?: vscode.OutputChannel
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IUpdateAgentFlowInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const input = options.input ?? {};
    const action = input.action ?? "start";
    const step = input.step?.trim();
    const skill = input.skill?.trim();

    this.output?.appendLine(
      `[flow] invoke action=${action} step=${step ?? "-"} skill=${skill ?? "-"}`
    );

    if (action === "reset") {
      this.stateService.resetFlow();
      return textResult("Agent flow reset.");
    }

    if (action === "complete") {
      this.stateService.completeActive();
      return textResult(
        step
          ? `Completed step "${step}".`
          : "Completed the current step."
      );
    }

    if (action === "handoff") {
      const agent = input.agent?.trim();
      if (!agent) {
        return textResult(
          "No handoff target provided. Pass { action: \"handoff\", agent: \"...\" } and optionally step/skill."
        );
      }
      this.stateService.handoffToAgent(agent, step, skill || undefined);
      return textResult(
        step
          ? `Handed off to "${agent}" and started step "${step}".`
          : `Handed off to "${agent}".`
      );
    }

    // action === "start"
    if (!step) {
      return textResult(
        "No step label provided. Pass { step: \"...\" } to mark a new active step."
      );
    }
    this.stateService.startStep(step, skill || undefined);
    return textResult(
      skill
        ? `Started step "${step}" (skill: ${skill}).`
        : `Started step "${step}".`
    );
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IUpdateAgentFlowInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const input = options.input ?? {};
    const action = input.action ?? "start";
    if (action === "reset") {
      return { invocationMessage: "Resetting agent flow…" };
    }
    if (action === "complete") {
      return { invocationMessage: "Completing current flow step…" };
    }
    if (action === "handoff") {
      return {
        invocationMessage: input.agent
          ? `Handing off flow to ${input.agent}…`
          : "Handing off flow…",
      };
    }
    return {
      invocationMessage: input.step
        ? `Updating agent flow → ${input.step}`
        : "Updating agent flow…",
    };
  }
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}
