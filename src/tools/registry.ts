/**
 * Tool registry — assembles and filters tools for the engine.
 */

import type {
  Tool,
  ToolCategory,
  ToolProviderDefinitionContext,
  ToolProviderDefinitionOverride,
  ToolSource,
} from "./Tool.js";

export interface RegisteredTool {
  canonicalName: string;
  aliases: string[];
  category: ToolCategory;
  source: ToolSource;
  sourceName: string;
  qualifiedName: string;
  hidden: boolean;
  capability: string;
  tool: Tool;
}

export interface ProviderFacingToolDefinition {
  tool: Tool;
  registration: RegisteredTool;
  name: string;
  description: string;
  inputSchema: Tool["inputSchema"] | Record<string, unknown>;
}

export class ToolRegistry {
  private readonly tools: Map<string, RegisteredTool> = new Map();
  private readonly aliases: Map<string, string> = new Map();

  /**
   * Register a tool.
   */
  register(tool: Tool): void {
    const registration = createRegisteredTool(tool);

    this.tools.set(registration.canonicalName, registration);
    this.aliases.set(registration.canonicalName, registration.canonicalName);
    this.aliases.set(registration.qualifiedName, registration.canonicalName);

    for (const alias of registration.aliases) {
      this.aliases.set(alias, registration.canonicalName);
    }
  }

  /**
   * Register multiple tools at once.
   */
  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Resolve a tool by canonical name, alias, or qualified name.
   */
  get(name: string): Tool | undefined {
    const registration = this.resolveRegistration(name);
    return registration?.tool;
  }

  /**
   * Get the full registration for a tool.
   */
  getRegistration(name: string): RegisteredTool | undefined {
    return this.resolveRegistration(name);
  }

  /**
   * Get all canonical tool registrations.
   */
  getAllRegistrations(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all registered tools.
   */
  getAll(): Tool[] {
    return this.getAllRegistrations().map((registration) => registration.tool);
  }

  /**
   * Get provider-facing visible tools only.
   */
  getVisibleTools(): Tool[] {
    return this.getAllRegistrations()
      .filter((registration) => !registration.hidden)
      .map((registration) => registration.tool);
  }

  /**
   * Get tool names.
   */
  getToolNames(): string[] {
    return this.getAllRegistrations().map((registration) => registration.canonicalName);
  }

  /**
   * Search tool metadata by name/category/alias text.
   */
  search(query: string, includeHidden = false): RegisteredTool[] {
    const normalized = query.trim().toLowerCase();
    return this.getAllRegistrations().filter((registration) => {
      if (!includeHidden && registration.hidden) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      const haystacks = [
        registration.canonicalName,
        registration.qualifiedName,
        registration.category,
        registration.capability,
        ...registration.aliases,
      ].map((value) => value.toLowerCase());

      return haystacks.some((value) => value.includes(normalized));
    });
  }

  /**
   * Provider-facing definitions with alias/tool metadata resolved.
   */
  getProviderDefinitions(context: ToolProviderDefinitionContext = {}): ProviderFacingToolDefinition[] {
    return this.getAllRegistrations()
      .flatMap((registration) => buildProviderDefinitions(registration, context));
  }

  /**
   * Filter tools by allowed names.
   */
  filterByNames(allowedNames: string[]): Tool[] {
    const allowedCanonicalNames = new Set(
      allowedNames
        .map((name) => this.resolveRegistration(name)?.canonicalName)
        .filter((value): value is string => Boolean(value)),
    );

    return this.getAllRegistrations()
      .filter((registration) => allowedCanonicalNames.has(registration.canonicalName))
      .map((registration) => registration.tool);
  }

  /**
   * Remove a tool from the registry.
   */
  unregister(name: string): boolean {
    const registration = this.resolveRegistration(name);
    if (!registration) {
      return false;
    }

    this.tools.delete(registration.canonicalName);
    for (const [alias, canonicalName] of this.aliases.entries()) {
      if (canonicalName === registration.canonicalName) {
        this.aliases.delete(alias);
      }
    }

    return true;
  }

  /**
   * Clear all tools.
   */
  clear(): void {
    this.tools.clear();
    this.aliases.clear();
  }

  private resolveRegistration(name: string): RegisteredTool | undefined {
    const canonicalName = this.aliases.get(name) ?? name;
    return this.tools.get(canonicalName);
  }
}

function createRegisteredTool(tool: Tool): RegisteredTool {
  const canonicalName = tool.name;
  const aliases = uniqueStrings(tool.aliases ?? []);
  const category = tool.category ?? "legacy";
  const source = tool.source ?? "builtin";
  const sourceName = tool.sourceName ?? source;
  const qualifiedName = `${sourceName}:${canonicalName}`;

  return {
    canonicalName,
    aliases,
    category,
    source,
    sourceName,
    qualifiedName,
    hidden: tool.hidden ?? false,
    capability: tool.capability ?? canonicalName,
    tool,
  };
}

function buildProviderDefinitions(
  registration: RegisteredTool,
  context: ToolProviderDefinitionContext,
): ProviderFacingToolDefinition[] {
  if (registration.hidden) {
    return [];
  }

  const overrides = registration.tool.providerDefinitions ?? [];
  if (overrides.length === 0) {
    return [
      {
        tool: registration.tool,
        registration,
        name: registration.canonicalName,
        description: registration.tool.description,
        inputSchema: registration.tool.inputSchema,
      },
    ];
  }

  const matchingOverrides = overrides.filter((override) => matchesOverride(override, context));
  if (matchingOverrides.length === 0) {
    return [
      {
        tool: registration.tool,
        registration,
        name: registration.canonicalName,
        description: registration.tool.description,
        inputSchema: registration.tool.inputSchema,
      },
    ];
  }

  return matchingOverrides
    .filter((override) => override.hidden !== true)
    .map((override) => ({
      tool: registration.tool,
      registration,
      name: override.name ?? registration.canonicalName,
      description: override.description ?? registration.tool.description,
      inputSchema: override.inputSchema ?? registration.tool.inputSchema,
    }));
}

function matchesOverride(
  override: ToolProviderDefinitionOverride,
  context: ToolProviderDefinitionContext,
): boolean {
  if (override.providerId && override.providerId !== context.providerId) {
    return false;
  }

  if (override.modelPattern && !override.modelPattern.test(context.model ?? "")) {
    return false;
  }

  return true;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
