import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsService } from "../src/main/services.js";
import { validateRouteInput } from "../src/shared/contracts.js";
import { boardNodePositionKey } from "../src/shared/boards.js";
import type { BoardState } from "../src/shared/types.js";

test("legacy folders become independent boards and keep their sessions", () => {
  const home = mkdtempSync(join(tmpdir(), "pix-boards-"));
  try {
    const settings = new SettingsService(null);
    settings.appPath = join(home, "settings.json");
    const first = { name: "one", path: join(home, "one") };
    const second = { name: "two", path: join(home, "two") };
    settings.rememberProject(first, []);
    settings.rememberProject(second, []);
    settings.lastProject(first.path);

    const migrated = settings.boardState();
    assert.equal(migrated.boards.length, 2);
    assert.equal(migrated.boards.find(board => board.id === migrated.activeBoardId)?.name, "one");
    assert.deepEqual(migrated.boards.map(board => board.projectIds.length), [1, 1]);

    const saved = validateRouteInput("board.save", { state: {
      boards: [{ ...migrated.boards[0], projectIds: migrated.boards.flatMap(board => board.projectIds),
        positions: { [migrated.boards[0]!.projectIds[0]!]: { x: 10, y: 20 } } }],
      groups: [{ id: "group", name: "Work" }], activeBoardId: migrated.boards[0]!.id,
    } }).state;
    settings.saveBoardState(saved as typeof migrated);
    settings.reset();
    assert.deepEqual(settings.boardState(), saved);
    assert.equal(JSON.parse(readFileSync(settings.appPath, "utf8")).recentProjects.length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("board route rejects invalid references and positions", () => {
  const valid = { boards: [{ id: "board", name: "Board", groupId: null, projectIds: ["folder"] }], groups: [], activeBoardId: "board" };
  assert.throws(() => validateRouteInput("board.save", { state: { ...valid, activeBoardId: "missing" } }), /active board/);
  assert.throws(() => validateRouteInput("board.save", { state: { ...valid, boards: [{ ...valid.boards[0], positions: { other: { x: 1, y: 2 } } }] } }), /position/);
  assert.throws(() => validateRouteInput("board.save", { state: { ...valid, boards: [{ ...valid.boards[0], sessions: [{ projectId: "other", path: "/s.jsonl" }] }] } }), /sessions/);
  const withSession = { ...valid.boards[0], sessions: [{ projectId: "folder", path: "/s.jsonl" }] };
  const key = boardNodePositionKey("folder", "/s.jsonl", "turn:one");
  const saved = validateRouteInput("board.save", { state: { ...valid, boards: [{ ...withSession,
    positions: { [key]: { x: 120, y: 240, branch: true } } }] } }).state as BoardState;
  assert.deepEqual(saved.boards[0]?.positions?.[key],
  { x: 120, y: 240, branch: true });
  assert.throws(() => validateRouteInput("board.save", { state: { ...valid, boards: [{ ...valid.boards[0],
    positions: { [key]: { x: 120, y: 240 } } }] } }), /position/);
});
