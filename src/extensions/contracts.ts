/**
 * Extension contracts for MCP, plugins, and skills.
 *
 * Extensions can contribute:
 * - Tools (capabilities the agent can invoke)
 * - Commands (slash commands for the REPL)
 * - Providers (AI model adapters)
 * - Hooks (lifecycle callbacks)
 */

import type { Tool } from "../tools/Tool.js";
import type { Command } from "../commands/types.js";
import type { Provider } from "../providers/types.js";

/**
 * Extension lifecycle hooks.
 */
export interface ExtensionHooks {
  /** Called when the extension is loaded */
  onActivate?(): Promise<void>;
  /** Called when the extension is unloaded */
  onDeactivate?(): Promise<void>;
  /** Called at session start */
  onSessionStart?(): Promise<void>;
  /** Called at session end */
  onSessionEnd?(): Promise<void>;
  /** Called before each agent turn */
  onBeforeTurn?(): Promise<void>;
  /** Called after each agent turn */
  onAfterTurn?(): Promise<void>;
}

/**
 * Metadata for an extension.
 */
export interface ExtensionMetadata {
  /** Unique extension identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Extension version */
  version: string;
  /** Extension description */
  description?: string;
  /** Extension author */
  author?: string;
}

/**
 * Contract that all extensions must implement.
 */
export interface Extension {
  /** Extension metadata */
  metadata: ExtensionMetadata;
  /** Tools contributed by this extension */
  tools?: Tool[];
  /** Commands contributed by this extension */
  commands?: Command[];
  /** Providers contributed by this extension */
  providers?: Provider[];
  /** Lifecycle hooks */
  hooks?: ExtensionHooks;
}

/**
 * MCP server configuration.
 */
export interface McpServerConfig {
  /** Server name/identifier */
  name: string;
  /** Command to start the MCP server */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Transport type */
  transport?: "stdio" | "sse" | "http";
  /** URL for SSE/HTTP transports */
  url?: string;
}

/**
 * Skill definition for bundled or dynamic skills.
 */
export interface Skill {
  /** Unique skill identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** When this skill should be activated */
  triggers: string[];
  /** Skill instructions (injected into system prompt) */
  instructions: string;
  /** Tools this skill requires */
  requiredTools?: string[];
}

/**
 * Plugin manifest for discovery and loading.
 */
export interface PluginManifest {
  /** Plugin identifier */
  id: string;
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Minimum pebble version required */
  minPebbleVersion?: string;
  /** Plugin entry point */
  entry: string;
  /** Plugin dependencies */
  dependencies?: string[];
}

/**
 * Registry for managing extensions.
 */
export interface ExtensionRegistry {
  /** Register an extension */
  register(extension: Extension): void;
  /** Get all registered tools */
  getTools(): Tool[];
  /** Get all registered commands */
  getCommands(): Command[];
  /** Get all registered providers */
  getProviders(): Provider[];
  /** Get all registered hooks */
  getHooks(): ExtensionHooks[];
  /** Load extensions from a directory */
  loadFromDirectory(dir: string): Promise<void>;
  /** Load MCP servers from config */
  loadMcpServers(configs: McpServerConfig[]): Promise<void>;
  /** Load skills from config */
  loadSkills(skills: Skill[]): void;
}
