import { z } from 'zod';

export const UpdateMeBody = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(2, 'Name muss mindestens 2 Zeichen haben').max(60, 'Name darf höchstens 60 Zeichen haben'),
  ),
});
