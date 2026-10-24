import {
  AssistantReplyResponseSchema,
  AssistantRequestSchema,
  ErrorResponseSchema,
} from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';

import type { AppDependencies } from '#api/dependencies';
import { cacheControl } from '#api/plugins/cache-control';
import { requestContext } from '#api/plugins/request-context';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'minimax/minimax-m3.1-flash';
const UPSTREAM_TIMEOUT_MS = 25_000;

/**
 * Stateless OpenRouter proxy. The browser sends the conversation; the Worker adds the credential,
 * model, and timeout. No data is written, and nothing from the upstream response is cached.
 */
export function createAssistantRoutes(dependencies: AppDependencies) {
  return new Elysia({ name: 'assistant-routes' })
    .use(requestContext)
    .use(cacheControl)
    .post(
      '/assistant',
      async ({ body, envelope, fail }) => {
        const apiKey = dependencies.openRouterApiKey?.trim();
        if (apiKey === undefined || apiKey === '') {
          return fail('ASSISTANT_UNAVAILABLE');
        }
        const model = dependencies.openRouterModel?.trim() || DEFAULT_MODEL;
        const send = dependencies.fetchAssistant ?? fetch;

        let upstream: Response;
        try {
          upstream = await send(OPENROUTER_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://jaga-daerah.pages.dev',
              'X-Title': 'JagaDaerah - Transparansi Daerah',
            },
            body: JSON.stringify({
              model,
              messages: body.messages,
              temperature: 0.2,
              max_tokens: 800,
            }),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          });
        } catch {
          return fail('ASSISTANT_UNAVAILABLE');
        }

        if (!upstream.ok) {
          return fail(upstream.status === 429 ? 'RATE_LIMITED' : 'ASSISTANT_UNAVAILABLE');
        }

        let content: unknown;
        try {
          const payload = (await upstream.json()) as {
            choices?: Array<{ message?: { content?: unknown } }>;
          };
          content = payload.choices?.[0]?.message?.content;
        } catch {
          return fail('ASSISTANT_UNAVAILABLE');
        }

        if (typeof content !== 'string' || content.trim() === '') {
          return fail('ASSISTANT_UNAVAILABLE');
        }

        return envelope({ reply: content, model });
      },
      {
        cache: 'none',
        body: AssistantRequestSchema,
        response: {
          200: AssistantReplyResponseSchema,
          400: ErrorResponseSchema,
          429: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    );
}
