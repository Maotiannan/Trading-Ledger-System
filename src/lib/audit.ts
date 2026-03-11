import { db } from '@/lib/db';
import type { AuditAction, AuditTargetType } from '@/lib/audit-catalog';

export type AuditEvent = {
  action: AuditAction | string;
  actorId: string;
  targetType: AuditTargetType | string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  at?: string;
};

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

class ConsoleAuditSink implements AuditSink {
  async write(event: AuditEvent): Promise<void> {
    console.info('[AUDIT]', JSON.stringify(event));
  }
}

class PrismaAuditSink implements AuditSink {
  async write(event: AuditEvent): Promise<void> {
    const auditLog = (db as unknown as {
      auditLog?: {
        create: (input: {
          data: {
            action: string;
            actorId: string;
            targetType: string;
            targetId?: string | null;
            metadata?: Record<string, unknown> | null;
            createdAt?: Date;
          };
        }) => Promise<unknown>;
      };
    }).auditLog;

    if (!auditLog) {
      throw new Error('AuditLog model is not available in Prisma client');
    }

    await auditLog.create({
      data: {
        action: event.action,
        actorId: event.actorId,
        targetType: event.targetType,
        targetId: event.targetId || null,
        metadata: event.metadata || null,
        createdAt: event.at ? new Date(event.at) : new Date(),
      },
    });
  }
}

let sink: AuditSink = new PrismaAuditSink();
const fallbackSink: AuditSink = new ConsoleAuditSink();

export function setAuditSink(nextSink: AuditSink): void {
  sink = nextSink;
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const normalized = {
    ...event,
    at: event.at || new Date().toISOString(),
  };

  try {
    await sink.write(normalized);
  } catch (error) {
    console.warn('[AUDIT_FALLBACK]', error);
    await fallbackSink.write(normalized);
  }
}
