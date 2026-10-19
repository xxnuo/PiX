import { defineStore } from "pinia";
import { markRaw, toRaw } from "vue";
import type { Board, BoardState, SessionSnapshot } from "../../shared/types";
import { useLayoutStore } from "./layout";
import { desktop } from "../api";
import { boardNodePositionKey } from "../../shared/boards";

const saves = new WeakMap<object, Promise<unknown>>();
export const boardSessionKey = (projectId: string, path: string) => `${projectId}\0${path}`;
export const useBoardStore = defineStore("boards", {
  state: () => ({ state: null as BoardState | null,
    snapshots: {} as Record<string, SessionSnapshot>, snapshotRevision: 0 }),
  getters: {
    enabled: () => useLayoutStore().settings?.app.experimentalCanvas === true,
    active(state): Board | undefined {
      if (!this.enabled) return undefined;
      return state.state?.boards.find(board => board.id === state.state?.activeBoardId);
    },
  },
  actions: {
    async load() {
      await saves.get(this)?.catch(() => {});
      this.state = await desktop.invoke<BoardState>("board.state");
      void this.loadSnapshots();
    },
    capture(projectId: string, snapshot: SessionSnapshot) {
      const key = boardSessionKey(projectId, snapshot.session.path);
      if (!this.state?.boards.some(board => board.sessions?.some(item => boardSessionKey(item.projectId, item.path) === key))) return;
      const previous = this.snapshots[key];
      if (previous?.graph && snapshot.graph && previous.graph.epoch === snapshot.graph.epoch &&
        previous.graph.revision > snapshot.graph.revision) return;
      this.snapshots[key] = markRaw(snapshot);
      this.snapshotRevision++;
    },
    async loadSnapshots() {
      const entries = this.active?.sessions ?? [];
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (cursor < entries.length) {
          const item = entries[cursor++]!;
          try {
            const snapshot = await desktop.invoke<SessionSnapshot>("session.inspect", item);
            this.capture(item.projectId, snapshot);
          } catch { /* A disconnected folder keeps its last visible graph. */ }
        }
      }));
    },
    change(update: (state: BoardState, boardId: string) => void) {
      if (!this.enabled || !this.state) return Promise.resolve();
      const boardId = this.state.activeBoardId;
      const saved = (saves.get(this) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const next = structuredClone(toRaw(this.state!));
        update(next, boardId);
        this.state = await desktop.invoke<BoardState>("board.save", { state: next });
      });
      saves.set(this, saved);
      return saved;
    },
    create() {
      const id = crypto.randomUUID();
      return this.change(state => {
        state.boards.push({ id, name: `Board ${state.boards.length + 1}`, groupId: null, projectIds: [], positions: {} });
        state.activeBoardId = id;
      });
    },
    select(id: string) {
      return this.change(state => { state.activeBoardId = id; }).then(() => { void this.loadSnapshots(); });
    },
    rename(id: string, name: string) {
      return this.change(state => {
        const board = state.boards.find(item => item.id === id);
        const group = state.groups.find(item => item.id === id);
        if (board) board.name = name;
        if (group) group.name = name;
      });
    },
    remove(id: string) {
      return this.change(state => {
        if (state.boards.length <= 1) return;
        state.boards = state.boards.filter(item => item.id !== id);
        if (state.activeBoardId === id) state.activeBoardId = state.boards[0]!.id;
      });
    },
    createGroup() {
      const id = crypto.randomUUID();
      return this.change(state => state.groups.push({ id, name: `Group ${state.groups.length + 1}` }));
    },
    removeGroup(id: string) {
      return this.change(state => {
        state.groups = state.groups.filter(item => item.id !== id);
        for (const board of state.boards) if (board.groupId === id) board.groupId = null;
      });
    },
    move(id: string, groupId: string | null) {
      return this.change(state => {
        const board = state.boards.find(item => item.id === id);
        if (board) board.groupId = groupId;
      });
    },
    addProject(projectId: string) {
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (board && !board.projectIds.includes(projectId)) board.projectIds.push(projectId);
      });
    },
    removeProject(projectId: string) {
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (board) {
          board.projectIds = board.projectIds.filter(id => id !== projectId);
          board.sessions = board.sessions?.filter(item => item.projectId !== projectId);
          if (board.positions) delete board.positions[projectId];
          if (board.positions) for (const key of Object.keys(board.positions))
            if (key.startsWith(`node:${JSON.stringify([projectId]).slice(0, -1)},`)) delete board.positions[key];
        }
      });
    },
    addSession(projectId: string, path: string) {
      if (this.active?.sessions?.some(item => item.projectId === projectId && item.path === path)) return Promise.resolve();
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (!board || !board.projectIds.includes(projectId)) return;
        board.sessions ??= [];
        if (!board.sessions.some(item => item.projectId === projectId && item.path === path))
          board.sessions.push({ projectId, path });
      });
    },
    removeSession(projectId: string, path: string) {
      delete this.snapshots[boardSessionKey(projectId, path)];
      this.snapshotRevision++;
      if (!this.state?.boards.some(board => board.sessions?.some(item => item.projectId === projectId && item.path === path)))
        return Promise.resolve();
      return this.change(state => {
        for (const board of state.boards) {
          board.sessions = board.sessions?.filter(item => item.projectId !== projectId || item.path !== path);
          if (board.positions) for (const key of Object.keys(board.positions))
            if (key.startsWith(`node:${JSON.stringify([projectId, path]).slice(0, -1)},`)) delete board.positions[key];
        }
      });
    },
    detachSession(projectId: string, path: string) {
      if (!this.active?.sessions?.some(item => item.projectId === projectId && item.path === path)) return Promise.resolve();
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (!board) return;
        board.sessions = board.sessions?.filter(item => item.projectId !== projectId || item.path !== path);
        if (board.positions) for (const key of Object.keys(board.positions))
          if (key.startsWith(`node:${JSON.stringify([projectId, path]).slice(0, -1)},`)) delete board.positions[key];
      }).then(() => {
        if (!this.state?.boards.some(board => board.sessions?.some(item => item.projectId === projectId && item.path === path)))
          delete this.snapshots[boardSessionKey(projectId, path)];
        this.snapshotRevision++;
      });
    },
    placeNode(projectId: string, path: string, nodeId: string, x: number, y: number, branch = false) {
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (board?.sessions?.some(item => item.projectId === projectId && item.path === path))
          (board.positions ??= {})[boardNodePositionKey(projectId, path, nodeId)] = { x, y, ...(branch ? { branch } : {}) };
      });
    },
    resetPositions() {
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (board) board.positions = {};
      });
    },
    setViewport(viewport: NonNullable<Board["viewport"]>) {
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (board) board.viewport = { ...viewport };
      });
    },
    place(projectId: string, x: number, y: number) {
      return this.change((state, boardId) => {
        const board = state.boards.find(item => item.id === boardId);
        if (board?.projectIds.includes(projectId)) (board.positions ??= {})[projectId] = { x, y };
      });
    },
  },
});
