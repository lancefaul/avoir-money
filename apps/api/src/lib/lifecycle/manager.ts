import type { HookRegistry } from './hook-registry.js';
import type { HookContext, LifecycleEvent } from './types.js';

export class TransactionLifecycleManager {
  constructor(private registry: HookRegistry) {}

  async dispatch(event: LifecycleEvent, ctx: HookContext): Promise<void> {
    const hooks = this.registry.getHooksForEvent(event);
    const enrichedCtx = { ...ctx, event };

    for (const hook of hooks) {
      const shouldRun = hook.condition ? hook.condition(enrichedCtx) : true;
      if (shouldRun) {
        await hook.execute(enrichedCtx);
      }
    }
  }
}
