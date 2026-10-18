import { z } from 'zod';

import { successEnvelope } from './envelope';

export const HealthResponseSchema = successEnvelope(
  z.object({
    status: z.literal('ok'),
  }),
);

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
