import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { invoiceSourceFetch } from './mucont-invoice-upstream';
import { metadataSchema, MucontInvoiceError, type InvoiceMetadata } from './mucont-invoice-contract';
import { logger } from '@/lib/logger';

// Shared by invoice reads, exports and notification snapshot preparation. No
// notification projector or financial write is invoked by cache refreshes.
export async function readInvoiceSourceMetadata(invoiceIds: string[]) {
  if (!invoiceIds.length) return new Map<string, { metadata: InvoiceMetadata | null; stale: boolean; availability: string; readAt: Date | null }>();
  const sources = await db.mucontInvoiceSource.findMany({ where: { invoiceId: { in: [...new Set(invoiceIds)] } } });
  const result = new Map<string, { metadata: InvoiceMetadata | null; stale: boolean; availability: string; readAt: Date | null }>();
  for (const source of sources) result.set(source.invoiceId!, { metadata: source.metadata as InvoiceMetadata | null,
    stale: true, availability: source.metadataAvailability, readAt: source.metadataReadAt });
  for (let index = 0; index < sources.length; index += 100) {
    const batch = sources.slice(index, index + 100);
    const ids = batch.map((row) => row.invoiceBatchId);
    try {
      const response = await invoiceSourceFetch('/integrations/muledger/invoices/metadata-query', { method: 'POST', body: JSON.stringify({ invoiceBatchIds: ids }) });
      const parsed = metadataSchema.parse(await response.json());
      if (parsed.items.length !== ids.length || new Set(parsed.items.map((row) => row.invoiceBatchId)).size !== ids.length
        || parsed.items.some((row) => !ids.includes(row.invoiceBatchId))) throw new Error('Incomplete metadata response');
      for (const item of parsed.items) {
        const source = batch.find((row) => row.invoiceBatchId === item.invoiceBatchId)!;
        if (item.availability !== 'available') {
          await db.mucontInvoiceSource.update({ where: { invoiceBatchId: item.invoiceBatchId }, data: { metadataAvailability: item.availability } });
          result.get(source.invoiceId!)!.availability = item.availability;
          continue;
        }
        const current = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT invoiceBatchId FROM MucontInvoiceSource WHERE invoiceBatchId = ${item.invoiceBatchId} FOR UPDATE`;
          const cached = await tx.mucontInvoiceSource.findUniqueOrThrow({ where: { invoiceBatchId: item.invoiceBatchId } });
          if (cached.metadataVersion > item.metadataVersion) return cached;
          const updated = await tx.mucontInvoiceSource.update({ where: { invoiceBatchId: item.invoiceBatchId }, data: {
            metadata: item as Prisma.InputJsonValue, metadataVersion: item.metadataVersion, metadataReadAt: new Date(), metadataAvailability: 'available',
          } });
          if (cached.invoiceId) await tx.invoice.update({ where: { id: cached.invoiceId }, data: {
            shipDate: item.departureDate ? new Date(item.departureDate + 'T00:00:00Z') : null,
            releaseDate: item.releaseDate ? new Date(item.releaseDate + 'T00:00:00Z') : null,
            estimatedArrivalDate: item.estimatedArrivalDate ? new Date(item.estimatedArrivalDate + 'T00:00:00Z') : null,
          } });
          return updated;
        });
        result.set(source.invoiceId!, { metadata: current.metadata as InvoiceMetadata | null, stale: false,
          availability: current.metadataAvailability, readAt: current.metadataReadAt });
      }
    } catch (error) {
      logger.warn('mucont.invoice.metadata.stale', { invoiceCount: batch.length, cause: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return result;
}

export function sourceDateFields(metadata: InvoiceMetadata | null) {
  return metadata ? { shipDate: metadata.departureDate, releaseDate: metadata.releaseDate, estimatedArrivalDate: metadata.estimatedArrivalDate } : {};
}

export function resolveInvoiceDateProjection<T extends { shipDate?: Date | null; releaseDate?: Date | null;
  mucontSource?: { metadata: unknown; metadataAvailability: string; metadataReadAt: Date | null } | null }>(invoice: T): T & {
    sourceMetadataStale?: boolean; sourceMetadataReadAt?: string | null;
  } {
  if (!invoice.mucontSource) return invoice;
  const source = invoice.mucontSource;
  const metadata = source.metadata as InvoiceMetadata | null;
  return { ...invoice,
    ...(metadata ? {
      shipDate: metadata.departureDate ? new Date(metadata.departureDate + 'T00:00:00Z') : null,
      releaseDate: metadata.releaseDate ? new Date(metadata.releaseDate + 'T00:00:00Z') : null,
    } : {}),
    sourceMetadataReadAt: source.metadataReadAt?.toISOString() || null,
    sourceMetadataStale: source.metadataAvailability !== 'available' || !metadata,
  };
}

export async function prepareNotificationInvoiceDates(input: {
  notificationIds?: string[]; customerIds?: string[]; invoiceWhere?: Prisma.InvoiceWhereInput;
}) {
  if (!input.notificationIds?.length && !input.customerIds?.length) return;
  const eventWhere = { id: { in: input.notificationIds || [] } };
  const sources = await db.mucontInvoiceSource.findMany({ where: { invoice: {
    AND: [input.invoiceWhere || {}, { OR: [
      { emailNotifications: { some: eventWhere } },
      { orders: { some: { receipts: { some: { emailNotifications: { some: eventWhere } } } } } },
      ...(input.customerIds?.length ? [{ orders: { some: { customerId: { in: input.customerIds } } } }] : []),
    ] }],
  } }, select: { invoiceId: true } });
  const result = await readInvoiceSourceMetadata(sources.flatMap((row) => row.invoiceId ? [row.invoiceId] : []));
  if ([...result.values()].some((row) => row.stale)) {
    throw new MucontInvoiceError(503, 'SOURCE_DATES_UNVERIFIED', 'Source dates could not be verified. Notification preparation is deferred.');
  }
}

export async function refreshSourceInvoiceDateRows<T extends { id: string; shipDate?: Date | null; releaseDate?: Date | null;
  mucontSource?: unknown }>(rows: T[]): Promise<T[]> {
  const metadata = await readInvoiceSourceMetadata(rows.filter((row) => row.mucontSource).map((row) => row.id));
  return rows.map((row) => {
    const current = metadata.get(row.id);
    if (!current) return row;
    const { mucontSource: _source, ...publicRow } = row;
    return { ...publicRow,
      ...(current.metadata ? {
        shipDate: current.metadata.departureDate ? new Date(current.metadata.departureDate + 'T00:00:00Z') : null,
        releaseDate: current.metadata.releaseDate ? new Date(current.metadata.releaseDate + 'T00:00:00Z') : null,
      } : {}),
      sourceMetadataStale: current.stale, sourceMetadataReadAt: current.readAt?.toISOString() || null,
    } as unknown as T;
  });
}
