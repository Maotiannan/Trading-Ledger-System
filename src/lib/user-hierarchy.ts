import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';

type UserNode = {
  id: string;
  parentId: string | null;
  level: number;
  role: 'ADMIN' | 'SALES' | 'USER';
};

export type HierarchyScope = {
  selfId: string;
  ancestorIds: Set<string>;
  descendantIds: Set<string>;
  visibleIds: Set<string>;
  ownerVisibleIds: Set<string>;
};

function buildChildrenMap(nodes: UserNode[]): Map<string, string[]> {
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    if (!childrenMap.has(node.parentId)) childrenMap.set(node.parentId, []);
    childrenMap.get(node.parentId)!.push(node.id);
  }
  return childrenMap;
}

export async function getHierarchyScope(currentUser: CurrentUser): Promise<HierarchyScope> {
  const nodes = await db.user.findMany({
    select: { id: true, parentId: true, level: true, role: true },
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenMap = buildChildrenMap(nodes as UserNode[]);

  const ancestorIds = new Set<string>();
  let cursor = byId.get(currentUser.id);
  while (cursor?.parentId) {
    const parent = byId.get(cursor.parentId);
    if (!parent || ancestorIds.has(parent.id)) break;
    ancestorIds.add(parent.id);
    cursor = parent;
  }

  const descendantIds = new Set<string>();
  const stack = [...(childrenMap.get(currentUser.id) || [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (descendantIds.has(id)) continue;
    descendantIds.add(id);
    const children = childrenMap.get(id);
    if (children && children.length > 0) {
      stack.push(...children);
    }
  }

  const visibleIds = new Set<string>([currentUser.id, ...ancestorIds, ...descendantIds]);
  const ownerVisibleIds = new Set<string>([currentUser.id, ...descendantIds]);
  return {
    selfId: currentUser.id,
    ancestorIds,
    descendantIds,
    visibleIds,
    ownerVisibleIds,
  };
}

export async function canAccessOwnerId(ownerId: string, currentUser: CurrentUser): Promise<boolean> {
  const scope = await getHierarchyScope(currentUser);
  return scope.ownerVisibleIds.has(ownerId);
}
