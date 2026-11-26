import { z } from 'zod';

export const groupChangesSchema = z.strictObject({
  version: z.literal(1), expectedPublicationSequence: z.number().int().min(0).max(2147483647),
  removedBillingGroupIds: z.array(z.string().min(1).max(128)).min(1).max(200), cancelInvoice: z.boolean(),
}).refine(row => new Set(row.removedBillingGroupIds).size === row.removedBillingGroupIds.length, 'Duplicate removed group.');
export type GroupChanges = z.infer<typeof groupChangesSchema>;
