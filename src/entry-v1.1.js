import base from './entry.js';
import { captureWatchtowerSnapshot } from './watchtower.js';
import { reportSystemError, reportSystemSuccess } from './error-bus.js';

const SOURCE = 'Search Intelligence';
const REPORTER = '<script src="https://errors.oceanliners.net/client-reporter.js?v=20260809-1"></script>';

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await base.fetch(request, env, ctx);
      return injectReporter(response, request.method);
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
    ctx.waitUntil((async () => {
      try {
        await captureWatchtowerSnapshot(env);
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

async function injectReporter(response, method) {
  if (method === 'HEAD' || !(response.headers.get('content-type') || '').includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('errors.oceanliners.net/client-reporter.js')) return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  const enhanced = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${REPORTER}</head>`) : `${REPORTER}${html}`;
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers: response.headers });
}
