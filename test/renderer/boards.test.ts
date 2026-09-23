import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { VueFlow } from "@vue-flow/core";
import { describe, expect, it, vi } from "vitest";
import { boardSessionKey, useBoardStore } from "../../src/renderer/stores/boards";
import { useSessionStore } from "../../src/renderer/stores/session";
import BoardCanvas from "../../src/renderer/features/graph/BoardCanvas.vue";
import GraphPanel from "../../src/renderer/features/graph/GraphPanel.vue";
import { useLayoutStore } from "../../src/renderer/stores/layout";
import { projectSession } from "../../src/shared/session";
import type { SessionSnapshot } from "../../src/shared/types";
import { boardNodePositionKey } from "../../src/shared/boards";
import { i18n } from "../../src/renderer/i18n";

describe("board state", () => {
  it("keeps multiple folder roots and their positions on one board", async () => {
    setActivePinia(createPinia());
    const initial = { boards: [{ id: "a", name: "A", groupId: null, projectIds: ["one"], positions: {} },
      { id: "b", name: "B", groupId: null, projectIds: [], positions: {} }], groups: [], activeBoardId: "a" };
    const saved: typeof initial[] = [];
    vi.mocked(window.pix!.invoke).mockImplementation(async (route, input) => {
      if (route === "board.state") return initial;
      if (route === "board.save") { saved.push(structuredClone((input as { state: typeof initial }).state)); return (input as { state: typeof initial }).state; }
      return {};
    });
    const boards = useBoardStore();
    await boards.load();
    await boards.addProject("two");
    await boards.place("two", 120, 240);
    await boards.addSession("two", "/two/s.jsonl");
    await boards.placeNode("two", "/two/s.jsonl", "turn:u1", 480, 260);
    expect(boards.active?.projectIds).toEqual(["one", "two"]);
    expect(boards.active?.positions?.two).toEqual({ x: 120, y: 240 });
    expect(boards.active?.positions?.[boardNodePositionKey("two", "/two/s.jsonl", "turn:u1")]).toEqual({ x: 480, y: 260 });
    await boards.select("b");
    expect(boards.active?.projectIds).toEqual([]);
    await boards.select("a");
    expect(boards.active?.positions?.two).toEqual({ x: 120, y: 240 });
    await boards.detachSession("two", "/two/s.jsonl");
    expect(boards.active?.sessions).toEqual([]);
    expect(boards.active?.positions?.[boardNodePositionKey("two", "/two/s.jsonl", "turn:u1")]).toBeUndefined();
    expect(saved.at(-1)?.activeBoardId).toBe("a");
  });

  it("renders every folder in the active board as a start point", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const pinia = createPinia(); setActivePinia(pinia);
    useBoardStore().state = { boards: [{ id: "board", name: "Work", groupId: null, projectIds: ["one", "two"] }], groups: [], activeBoardId: "board" };
    useSessionStore().projects = ["one", "two"].map(id => ({
      id, project: { name: id, path: `/${id}` }, sessions: [], lastOpened: "", connected: true,
    }));
    const wrapper = mount(BoardCanvas, { global: { plugins: [pinia, i18n] } });
    try {
      await flushPromises();
      expect(wrapper.findAll(".board-root").map(node => node.text())).toEqual([
        expect.stringContaining("one"), expect.stringContaining("two"),
      ]);
      await wrapper.findAll(".board-root button")[1]!.trigger("click");
      expect(wrapper.emitted("createProjectSession")?.[0]?.[0]).toEqual(useSessionStore().projects[1]);
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });

  it("keeps folder roots on the same canvas when a session graph opens", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const pinia = createPinia(); setActivePinia(pinia);
    const boards = useBoardStore();
    boards.state = { boards: [{ id: "board", name: "Work", groupId: null, projectIds: ["one", "two"],
      positions: { one: { x: 80, y: 80 }, two: { x: 80, y: 290 } } }], groups: [], activeBoardId: "board" };
    const session = useSessionStore();
    session.projects = ["one", "two"].map(id => ({ id, project: { name: id, path: `/${id}` }, sessions: [], lastOpened: "", connected: true }));
    session.activeProjectId = "one";
    const entries = [{ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hello" } }];
    session.current = { session: { id: "s", path: "/one/s.jsonl", cwd: "/one", created: "", modified: "", messageCount: 1, firstMessage: "hello" },
      entries, projection: projectSession(entries, "u1"), runtime: { available: false, isStreaming: false } } as SessionSnapshot;
    useLayoutStore().panelsSettled = true;
    const wrapper = mount(GraphPanel, { global: { plugins: [pinia, i18n] } });
    try {
      await flushPromises();
      const flow = (wrapper.findComponent(VueFlow).vm as any).$.exposed;
      expect(flow.findNode("folder:one").position).toEqual({ x: 80, y: 80 });
      expect(flow.findNode("folder:two").position).toEqual({ x: 80, y: 290 });
      const turn = flow.findNode(session.current.projection.nodes[0]!.id);
      expect(turn.position.x).toBeGreaterThan(380);
      expect(wrapper.findAll(".board-root")).toHaveLength(2);
      expect(turn.data.rooted).toBe(true);
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });

  it("keeps another folder's session graph and an empty session on the same canvas", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const pinia = createPinia(); setActivePinia(pinia);
    const boards = useBoardStore();
    boards.state = { boards: [{ id: "board", name: "Work", groupId: null, projectIds: ["one", "two"],
      sessions: [{ projectId: "one", path: "/one/a.jsonl" }, { projectId: "two", path: "/two/b.jsonl" }] }], groups: [], activeBoardId: "board" };
    const session = useSessionStore();
    session.projects = ["one", "two"].map(id => ({ id, project: { name: id, path: `/${id}` }, sessions: [], lastOpened: "", connected: id === "one" }));
    session.activeProjectId = "one";
    const entry = (id: string) => [{ type: "message", id, parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: id } }];
    const snapshot = (path: string, entries: ReturnType<typeof entry>): SessionSnapshot => ({
      session: { id: path, path, cwd: path.split("/")[1]!, created: "", modified: "", messageCount: 1, firstMessage: path },
      entries, projection: projectSession(entries, entries[0]?.id ?? null), runtime: { available: true, isStreaming: false },
    } as SessionSnapshot);
    session.current = snapshot("/one/a.jsonl", entry("a"));
    const other = snapshot("/two/b.jsonl", entry("b"));
    boards.snapshots[boardSessionKey("two", other.session.path)] = other;
    useLayoutStore().panelsSettled = true;
    const wrapper = mount(GraphPanel, { global: { plugins: [pinia, i18n] } });
    try {
      await flushPromises();
      const flow = (wrapper.findComponent(VueFlow).vm as any).$.exposed;
      expect(flow.findNode(session.current.projection.nodes[0]!.id)).toBeTruthy();
      const turnId = `board:${JSON.stringify(["two", other.session.path, other.projection.nodes[0]!.id])}`;
      const rootId = `board:${JSON.stringify(["two", other.session.path, "session"])}`;
      expect(flow.findNode(turnId)).toBeTruthy();
      expect(flow.findNode(turnId).data.runnable).toBe(true);
      expect(flow.findNode(rootId)).toBeTruthy();
      boards.capture("two", snapshot(other.session.path, []));
      await flushPromises();
      expect(flow.findNode(turnId)).toBeUndefined();
      expect(flow.findNode(rootId)).toBeTruthy();
      const pending = { ...snapshot(other.session.path, []),
        graph: { id: other.session.path, revision: 1, runs: [{ branchId: "main", runId: "run1", nodeId: null,
          pending: { text: "Running in other folder", parentNodeId: null }, status: "running" as const }] } } as SessionSnapshot;
      boards.capture("two", pending);
      await flushPromises();
      expect(flow.findNode(`board:${JSON.stringify(["two", other.session.path, "pending:run1"])}`)).toBeTruthy();
      expect(flow.findNode(rootId).data.running).toBe(true);
      delete boards.snapshots[boardSessionKey("two", other.session.path)];
      boards.snapshotRevision++;
      await flushPromises();
      expect(flow.findNode(rootId)).toBeTruthy();
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });
});
