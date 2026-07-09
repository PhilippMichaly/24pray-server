import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Mailer } from '../lib/mailer.js';
import type { Env } from '../env.js';

const FeedbackBody = z.object({
  message: z.string().min(5).max(2000),
  email: z.string().email().optional(),
  page: z.string().max(200).optional(),
});

export function feedbackRoutes(app: FastifyInstance, deps: { mailer?: Mailer; env?: Env }) {
  const { mailer, env } = deps;

  // Feedback ohne Login (gerade Fehler-Melder sind Gäste). Kein Drittanbieter, keine DB —
  // direkt als Mail an den Betreiber. Ohne FEEDBACK_TO existiert der Endpoint nicht (404).
  app.post('/feedback', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!env?.FEEDBACK_TO || !mailer?.sendFeedback) {
      return reply.code(404).send({ message: 'Nicht gefunden' });
    }
    const body = FeedbackBody.parse(req.body);
    await mailer.sendFeedback(env.FEEDBACK_TO, {
      message: body.message,
      replyTo: body.email,
      page: body.page,
    });
    return reply.code(204).send();
  });
}
