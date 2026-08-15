import type { HookDefinition, LifecycleEvent } from './types.js';

export class HookRegistry {
  private hooks: HookDefinition[] = [];

  register(hook: HookDefinition): void {
    if (this.hooks.some((h) => h.name === hook.name)) {
      throw new Error(`Hook with name "${hook.name}" is already registered`);
    }
    this.hooks.push(hook);
  }

  getHooksForEvent(event: LifecycleEvent): HookDefinition[] {
    const matching = this.hooks
      .map((hook, index) => ({ hook, index }))
      .filter(({ hook }) => hook.events.includes(event));

    matching.sort((a, b) => {
      const priorityA = a.hook.priority ?? 100;
      const priorityB = b.hook.priority ?? 100;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.index - b.index;
    });

    return matching.map(({ hook }) => hook);
  }

  clear(): void {
    this.hooks = [];
  }
}
