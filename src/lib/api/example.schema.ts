import { z } from "zod";

export const greetingInputSchema = z.object({ name: z.string().min(1) });
