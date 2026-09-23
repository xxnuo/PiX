import type { Board, BoardState } from "./types.js";

export function boardRootPosition(board: Board | undefined, id: string, index: number) {
  return board?.positions?.[id] ?? { x: 80, y: 80 + index * 900 };
}
export const boardNodePositionKey = (projectId: string, path: string, nodeId: string) =>
  `node:${JSON.stringify([projectId, path, nodeId])}`;

export function validateBoardState(value: unknown): BoardState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid board state");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.boards) || !Array.isArray(raw.groups) || typeof raw.activeBoardId !== "string")
    throw new Error("Invalid board state");
  if (!raw.boards.length || raw.boards.length > 1000 || raw.groups.length > 1000)
    throw new Error("Invalid board count");
  const groups = raw.groups.map((value) => {
    const item = value as Record<string, unknown>;
    if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim())
      throw new Error("Invalid board group");
    return { id: item.id, name: item.name.trim() };
  });
  const groupIds = new Set(groups.map(item => item.id));
  if (groupIds.size !== groups.length) throw new Error("Duplicate board group");
  const boards = raw.boards.map((value) => {
    const item = value as Record<string, unknown>;
    if (!item || typeof item.id !== "string" || !item.id ||
      typeof item.name !== "string" || !item.name.trim() ||
      !(item.groupId === null || (typeof item.groupId === "string" && groupIds.has(item.groupId))) ||
      !Array.isArray(item.projectIds) || item.projectIds.some(id => typeof id !== "string" || !id) ||
      new Set(item.projectIds).size !== item.projectIds.length)
      throw new Error("Invalid board");
    const positions = item.positions ?? {};
    const sessions = item.sessions ?? [];
    if (!Array.isArray(sessions) || sessions.some(value => !value || typeof value !== "object" ||
      typeof value.projectId !== "string" || !(item.projectIds as string[]).includes(value.projectId) ||
      typeof value.path !== "string" || !value.path) ||
      new Set(sessions.map(value => `${value.projectId}\0${value.path}`)).size !== sessions.length)
      throw new Error("Invalid board sessions");
    if (!positions || typeof positions !== "object" || Array.isArray(positions)) throw new Error("Invalid board positions");
    const checked: NonNullable<Board["positions"]> = {};
    for (const [id, point] of Object.entries(positions)) {
      let valid = (item.projectIds as string[]).includes(id);
      if (id.startsWith("node:")) {
        try {
          const key = JSON.parse(id.slice(5));
          valid = Array.isArray(key) && key.length === 3 && key.every(value => typeof value === "string" && value) &&
            sessions.some(value => value.projectId === key[0] && value.path === key[1]);
        } catch { valid = false; }
      }
      const p = point as { x?: unknown; y?: unknown; branch?: unknown };
      if (!valid || !p || typeof p.x !== "number" || !Number.isFinite(p.x) ||
        typeof p.y !== "number" || !Number.isFinite(p.y)) throw new Error("Invalid board position");
      if (p.branch !== undefined && typeof p.branch !== "boolean") throw new Error("Invalid board branch position");
      checked[id] = { x: p.x, y: p.y, ...(p.branch === true ? { branch: true } : {}) };
    }
    return { id: item.id, name: item.name.trim(), groupId: item.groupId as string | null,
      projectIds: item.projectIds as string[], positions: checked,
      sessions: sessions as Board["sessions"] };
  });
  if (new Set(boards.map(item => item.id)).size !== boards.length ||
    boards.some(item => groupIds.has(item.id)) || !boards.some(item => item.id === raw.activeBoardId))
    throw new Error("Invalid active board");
  return { boards, groups, activeBoardId: raw.activeBoardId };
}
