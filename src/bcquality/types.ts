/**
 * Shared types for the BCQuality customer/partner "custom layer" pipeline.
 *
 * A "layer" is one entry in `acdc.bcquality.customLayers`: a git fork of
 * BCQuality (or a compatible repo) whose `custom/knowledge/**` and
 * `custom/skills/**` folders we mirror into this extension's `globalStorage`
 * so agents can consume them.
 */

/** One `acdc.bcquality.customLayers` entry, normalized. */
export interface ICustomLayerEntry {
  /**
   * Short, unique layer id — enforced pattern `^[a-z][a-z0-9-]{1,31}$`.
   * Used as the mandatory `<id>__` filename prefix on every artifact
   * imported from this layer so nothing can collide with the bundled
   * Microsoft/Community/ALDC namespaces.
   */
  id: string;
  /** Human-friendly name (logs, prompts, consent dialogs). */
  name: string;
  /** Git HTTPS or SSH URL of the fork. */
  repository: string;
  /** Branch, tag, or 40-hex commit SHA. Empty → treated as `main`. */
  ref: string;
  /**
   * Optional VS Code `SecretStorage` key holding a Personal Access Token.
   * Set only for private repos. Never store the token itself in settings.
   */
  tokenSecretKey: string;
  /** Whether this layer is synced and exposed. */
  enabled: boolean;
}

/** Provenance metadata written next to each installed layer. */
export interface IProvenance {
  /** Layer id (matches folder name). */
  layerId: string;
  /** Repository URL as configured. */
  repository: string;
  /** Ref as configured (branch/tag/SHA). */
  ref: string;
  /** Full 40-hex SHA that was actually installed. */
  sha: string;
  /** ISO-8601 UTC timestamp of the successful sync. */
  syncedAt: string;
  /** How many `.instructions.md` files were installed. */
  instructionsCount: number;
  /** How many SKILL folders were installed. */
  skillsCount: number;
  /** Detected LICENSE text of the fork, when present. */
  license?: string;
}

/** Per-layer sync outcome. */
export type LayerSyncOutcome =
  | "installed"
  | "up-to-date"
  | "skipped-disabled"
  | "declined"
  | "error";

export interface ILayerSyncResult {
  layer: ICustomLayerEntry;
  outcome: LayerSyncOutcome;
  sha?: string;
  instructionsCount?: number;
  skillsCount?: number;
  message?: string;
}
