import "server-only";
import { db, schema, type Tx } from "@/db";

export async function audit(
  entry: {
    tenantId: string;
    actorId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    data?: unknown;
  },
  tx?: Tx,
) {
  await (tx ?? db).insert(schema.auditLog).values({
    tenantId: entry.tenantId,
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
  });
}
