import * as os from "os";
import * as vscode from "vscode";

/**
 * VS Code configuration keys for the SDD (Spec-Driven Development)
 * path/naming setup.
 */
const CFG_PLANS_ROOT = "acdc.plansRoot";
const CFG_SPEC_FOLDER_FORMAT = "acdc.specFolderFormat";
const CFG_SPEC_FILE_FORMAT = "acdc.specFileFormat";
const CFG_BRANCH_FORMAT = "acdc.branchFormat";

/** Built-in defaults. Keep in sync with `package.json` `contributes.configuration`. */
export const DEFAULT_SDD_CONFIG = {
  plansRoot: ".github/plans",
  specFolderFormat: "{req_name}",
  specFileFormat: "{req_name}.{type}.md",
  branchFormat: "feature/{slug}",
} as const;

/**
 * Variables that can be substituted into any SDD template
 * (`plansRoot` is a raw path and is NOT templated).
 *
 * Callers pass the *feature*-specific ones (`req_name`, `slug`, `type`, `seq`).
 * All other variables are computed from the current date, the OS user,
 * environment variables, etc. by {@link SddConfigResolver.render}.
 */
export interface ISddRenderVariables {
  /** Requirement name in kebab-case (e.g. `customer-loyalty`). */
  req_name?: string;
  /** Short URL-friendly slug (e.g. `customer-loyalty`). Defaults to `req_name`. */
  slug?: string;
  /** Contract type for spec files (`spec`, `architecture`, `test-plan`, ...). */
  type?: string;
  /** Optional explicit sequence number (otherwise `{seq}` renders as empty). */
  seq?: number;
  /**
   * Optional environment name (`dev`, `staging`, `prod`, ...) used by `{ENV}`.
   * Falls back to `process.env.ACDC_ENV` then to empty string.
   */
  env?: string;
  /** Optional filename metadata for `{filename}` / `{ext}` / `{size}`. */
  filename?: string;
  ext?: string;
  size?: string;
  /** Optional extra bag for advanced callers. Values are stringified as-is. */
  extra?: Record<string, string | number>;
}

/** Snapshot of the current resolved SDD configuration. */
export interface ISddConfigSnapshot {
  plansRoot: string;
  specFolderFormat: string;
  specFileFormat: string;
  branchFormat: string;
}

/**
 * Reads and applies the workspace SDD configuration:
 * - `acdc.plansRoot` — relative folder holding spec-driven artifacts
 * - `acdc.specFolderFormat` — template for spec folder names
 * - `acdc.specFileFormat` — template for spec file names
 * - `acdc.branchFormat` — template for git branch names
 *
 * Templates support the variable set documented in `variableReferenceMarkdown()`.
 * Instantiate once and reuse: each getter/render call reads config live so
 * changes take effect immediately without needing a restart.
 */
export class SddConfigResolver {
  /**
   * Returns the full resolved snapshot with all four config values.
   * Empty user settings fall back to the built-in defaults.
   */
  getSnapshot(): ISddConfigSnapshot {
    const config = vscode.workspace.getConfiguration();
    return {
      plansRoot: this.readString(config, CFG_PLANS_ROOT, DEFAULT_SDD_CONFIG.plansRoot),
      specFolderFormat: this.readString(
        config,
        CFG_SPEC_FOLDER_FORMAT,
        DEFAULT_SDD_CONFIG.specFolderFormat
      ),
      specFileFormat: this.readString(
        config,
        CFG_SPEC_FILE_FORMAT,
        DEFAULT_SDD_CONFIG.specFileFormat
      ),
      branchFormat: this.readString(
        config,
        CFG_BRANCH_FORMAT,
        DEFAULT_SDD_CONFIG.branchFormat
      ),
    };
  }

  /** Resolved plans root (relative to workspace root), normalized to forward slashes. */
  getPlansRoot(): string {
    return this.normalizeRelPath(this.getSnapshot().plansRoot);
  }

  /**
   * Renders a template string against the current date, environment, and the
   * supplied variables. Unknown `{tokens}` are left unchanged so callers can
   * detect them.
   */
  render(template: string, vars: ISddRenderVariables = {}): string {
    const map = this.buildVariableMap(vars);
    return template.replace(/\{([A-Za-z_][A-Za-z0-9_:.-]*)\}/g, (raw, key: string) => {
      if (key.startsWith("env:")) {
        const envName = key.slice("env:".length);
        return process.env[envName] ?? raw;
      }
      const value = map[key] ?? map[key.toLowerCase()];
      return value !== undefined ? value : raw;
    });
  }

  /** Convenience — renders the spec folder format and returns just the folder name. */
  renderSpecFolder(vars: ISddRenderVariables): string {
    return this.render(this.getSnapshot().specFolderFormat, vars);
  }

  /** Convenience — renders the spec file format and returns just the file name. */
  renderSpecFile(vars: ISddRenderVariables): string {
    return this.render(this.getSnapshot().specFileFormat, vars);
  }

  /** Convenience — renders the branch format. */
  renderBranch(vars: ISddRenderVariables): string {
    return this.render(this.getSnapshot().branchFormat, vars);
  }

  /**
   * Builds full workspace-relative paths for the resolved spec folder and
   * (optionally) the spec file inside it.
   * Returns POSIX-style paths so agents can quote them directly in Markdown.
   */
  renderPaths(vars: ISddRenderVariables): {
    plansRoot: string;
    specFolder: string;
    specFolderPath: string;
    specFile?: string;
    specFilePath?: string;
    branch?: string;
  } {
    const snapshot = this.getSnapshot();
    const plansRoot = this.normalizeRelPath(snapshot.plansRoot);
    const specFolder = this.render(snapshot.specFolderFormat, vars);
    const specFolderPath = this.joinPosix(plansRoot, specFolder);
    const result: ReturnType<SddConfigResolver["renderPaths"]> = {
      plansRoot,
      specFolder,
      specFolderPath,
    };
    if (vars.type) {
      const specFile = this.render(snapshot.specFileFormat, vars);
      result.specFile = specFile;
      result.specFilePath = this.joinPosix(specFolderPath, specFile);
    }
    result.branch = this.render(snapshot.branchFormat, vars);
    return result;
  }

  /**
   * Returns a Markdown reference table describing every variable the
   * resolver understands. Used by the `acdc_get_sdd_config` tool.
   */
  variableReferenceMarkdown(): string {
    return [
      "## Template variables",
      "",
      "### Date & time (from the moment the template is rendered)",
      "| Variable | Description | Example |",
      "| --- | --- | --- |",
      "| `{YYYY}` / `{yyyy}` | 4-digit year | `2026` |",
      "| `{YY}` / `{yy}` | 2-digit year | `26` |",
      "| `{MM}` | 2-digit month | `07` |",
      "| `{M}` | Month, no padding | `7` |",
      "| `{MMM}` | 3-letter month | `Jul` |",
      "| `{DD}` / `{dd}` | 2-digit day of month | `13` |",
      "| `{D}` / `{d}` | Day of month, no padding | `13` |",
      "| `{DDD}` / `{ddd}` | 3-letter day of week | `Mon` |",
      "| `{HH}` | 2-digit hour (24h) | `16` |",
      "| `{hh}` | 2-digit hour (12h) | `04` |",
      "| `{mm}` | 2-digit minute | `46` |",
      "| `{ss}` | 2-digit second | `50` |",
      "| `{YYYYMMDD}` | Convenience — full date | `20260713` |",
      "| `{HHmmss}` | Convenience — full time | `164650` |",
      "",
      "### Sequence & identity",
      "| Variable | Description |",
      "| --- | --- |",
      "| `{seq}` / `{i}` / `{n}` | Sequence number (caller-provided; empty if none) |",
      "| `{00seq}` / `{000seq}` / `{0000seq}` | Zero-padded sequence |",
      "| `{GUID}` / `{UUID}` | Randomly generated UUID v4 |",
      "",
      "### System & environment",
      "| Variable | Description |",
      "| --- | --- |",
      "| `{USER}` / `{USERNAME}` | OS user account |",
      "| `{HOST}` / `{COMPUTERNAME}` | Machine hostname |",
      "| `{PID}` | Process ID of the extension host |",
      "| `{ENV}` | Deployment environment (from `env` arg or `ACDC_ENV`) |",
      "| `{env:NAME}` | Any environment variable (e.g. `{env:USERPROFILE}`) |",
      "",
      "### Feature / file metadata",
      "| Variable | Description |",
      "| --- | --- |",
      "| `{req_name}` | Requirement name (kebab-case) |",
      "| `{slug}` | Short URL-friendly slug (defaults to `{req_name}`) |",
      "| `{type}` | Contract type: `spec`, `architecture`, `test-plan`, ... |",
      "| `{filename}` / `{ext}` / `{size}` | File-specific metadata (caller-provided) |",
    ].join("\n");
  }

  /* ------------------------------------------------------------------ */

  private readString(
    config: vscode.WorkspaceConfiguration,
    key: string,
    fallback: string
  ): string {
    const value = config.get<string>(key);
    if (typeof value !== "string") { return fallback; }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private normalizeRelPath(raw: string): string {
    return raw.replace(/\\/g, "/").replace(/\/+$/g, "").replace(/^\/+/, "");
  }

  private joinPosix(...parts: string[]): string {
    return parts
      .filter((p) => p !== undefined && p !== null && p !== "")
      .map((p, i) => (i === 0 ? p.replace(/\/+$/g, "") : p.replace(/^\/+/g, "").replace(/\/+$/g, "")))
      .join("/");
  }

  private buildVariableMap(vars: ISddRenderVariables): Record<string, string> {
    const now = new Date();
    const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
    const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hour = now.getHours();
    const min = now.getMinutes();
    const sec = now.getSeconds();

    const map: Record<string, string> = {
      // Date / time
      YYYY: String(year),
      yyyy: String(year),
      YY: String(year).slice(-2),
      yy: String(year).slice(-2),
      MM: pad(month),
      M: String(month),
      MMM: monthShort[month - 1],
      DD: pad(day),
      dd: pad(day),
      D: String(day),
      d: String(day),
      DDD: dayShort[now.getDay()],
      ddd: dayShort[now.getDay()],
      HH: pad(hour),
      hh: pad(hour % 12 === 0 ? 12 : hour % 12),
      mm: pad(min),
      ss: pad(sec),
      YYYYMMDD: `${year}${pad(month)}${pad(day)}`,
      HHmmss: `${pad(hour)}${pad(min)}${pad(sec)}`,

      // Identity
      GUID: this.generateUuid(),
      UUID: this.generateUuid(),
      USER: this.getUser(),
      USERNAME: this.getUser(),
      HOST: os.hostname(),
      COMPUTERNAME: os.hostname(),
      PID: String(process.pid),
      ENV: vars.env ?? process.env.ACDC_ENV ?? "",

      // Feature
      req_name: vars.req_name ?? "",
      slug: vars.slug ?? vars.req_name ?? "",
      type: vars.type ?? "",

      // Sequence
      seq: vars.seq !== undefined ? String(vars.seq) : "",
      i: vars.seq !== undefined ? String(vars.seq) : "",
      n: vars.seq !== undefined ? String(vars.seq) : "",

      // File metadata
      filename: vars.filename ?? "",
      ext: vars.ext ?? "",
      size: vars.size ?? "",
    };

    // Zero-padded sequence variants
    if (vars.seq !== undefined) {
      map["00seq"] = pad(vars.seq, 2);
      map["000seq"] = pad(vars.seq, 3);
      map["0000seq"] = pad(vars.seq, 4);
    } else {
      map["00seq"] = "";
      map["000seq"] = "";
      map["0000seq"] = "";
    }

    // Extras override everything else
    if (vars.extra) {
      for (const [k, v] of Object.entries(vars.extra)) {
        map[k] = String(v);
      }
    }

    return map;
  }

  private getUser(): string {
    try {
      return os.userInfo().username;
    } catch {
      return process.env.USERNAME ?? process.env.USER ?? "";
    }
  }

  private generateUuid(): string {
    // RFC 4122 v4 without pulling a dependency in.
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++) { bytes[i] = Math.floor(Math.random() * 256); }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
