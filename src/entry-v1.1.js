import base from './entry.js';
import { reportSystemError, reportSystemSuccess } from './error-bus.js';

const SOURCE = 'Search Intelligence';

export default {
  async fetch(request, env, ctx) {
    try {
      return await base.fetch(request, env, ctx);
    } catch (error) {
      ctx?.waitUntil?.(reportSystemError(env, {
        source: SOURCE,
        component: 'request-handler',
        error,
        severity: 'p1',
        type: 'unhandled-request-error',
        context: { method: request.method, path: new URL(request.url).pathname }
      }));
      throw error;
    }
  },

  async scheduled(controller, env, ctx) {
    const pending = [];
    const captureCtx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };
    ctx.waitUntil((async () => {
      try {
        await base.scheduled(controller, env, captureCtx);
        await Promise.all(pending);
        await reportSystemSuccess(env, {
          source: SOURCE,
          component: 'watchtower-snapshot',
          message: 'Daily Watchtower snapshot completed successfully.',
          maxAgeMinutes: 2160,
        });
      } catch (error) {
        await reportSystemError(env, {
          source: SOURCE,
          component: 'watchtower-snapshot',
          error,
          severity: 'p1',
          type: 'scheduled-watchtower-error',
        });
        console.error('Watchtower scheduled capture failed', error);
      }
    })());
  }
};
