import { CommandRegistry } from "./registry";
import { createLoginCommand, createLogoutCommand, createModelCommand, createPermissionsCommand } from "./builtins/auth.js";
import { createClearCommand, createConfigCommand, createExitCommand, createHelpCommand, createInitCommand, createProviderCommand, createSidebarCommand, createVoiceCommand } from "./builtins/core.js";
import { createReviewCommand } from "./builtins/dev.js";
import { createCompactCommand, createMemoryCommand, createPlanCommand, createResumeCommand } from "./builtins/session.js";

/**
 * Register all built-in commands.
 */
export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register(createHelpCommand());
  registry.register(createClearCommand());
  registry.register(createExitCommand());
  registry.register(createInitCommand());
  registry.register(createLoginCommand());
  registry.register(createLogoutCommand());
  registry.register(createConfigCommand());
  registry.register(createProviderCommand());
  registry.register(createPermissionsCommand());
  registry.register(createModelCommand());
  registry.register(createResumeCommand());
  registry.register(createMemoryCommand());
  registry.register(createCompactCommand());
  registry.register(createPlanCommand());
  registry.register(createReviewCommand());
  registry.register(createSidebarCommand());
  registry.register(createVoiceCommand());
}
