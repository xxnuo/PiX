import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { VueFlow } from "@vue-flow/core";
import { describe, expect, it, vi } from "vitest";
import { boardSessionKey, useBoardStore } from "../../src/renderer/stores/boards";
import { useSessionStore } from "../../src/renderer/stores/session";
import AppTitlebar from "../../src/renderer/features/workbench/AppTitlebar.vue";
import { useWorkspaceStore } from "../../src/renderer/stores/workspace";
import GraphPanel from "../../src/renderer/features/graph/GraphPanel.vue";
import { useLayoutStore } from "../../src/renderer/stores/layout";
import { projectSession } from "../../src/shared/session";
import type { SessionSnapshot } from "../../src/shared/types";
import { boardNodePositionKey } from "../../src/shared/boards";
import { i18n } from "../../src/renderer/i18n";

function enableBoards() {
  useLayoutStore().settings = { app: { experimentalCanvas: true } } as any;
}

describe("board state", () => {
  it("keeps multiple folder roots and their positions on one board", async () => {
    setActivePinia(createPinia()); enableBoards();
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
    await boards.setViewport({ x: -230, y: 120, zoom: 0.7 });
    await boards.select("b");
    expect(boards.active?.viewport).toBeUndefined();
    expect(boards.active?.projectIds).toEqual([]);
    await boards.select("a");
    expect(boards.active?.viewport).toEqual({ x: -230, y: 120, zoom: 0.7 });
    expect(boards.active?.positions?.two).toEqual({ x: 120, y: 240 });
    await boards.detachSession("two", "/two/s.jsonl");
    expect(boards.active?.sessions).toEqual([]);
    expect(boards.active?.positions?.[boardNodePositionKey("two", "/two/s.jsonl", "turn:u1")]).toBeUndefined();
    expect(saved.at(-1)?.activeBoardId).toBe("a");
    await boards.resetPositions();
    expect(boards.active?.positions).toEqual({});
    expect(saved.at(-1)?.boards[0]?.positions).toEqual({});
  });

  it("keeps queued edits attached to their originating canvas", async () => {
    setActivePinia(createPinia()); enableBoards();
    const boards = useBoardStore();
    boards.state = { boards: ["a", "b"].map(id => ({ id, name: id, groupId: null,
      projectIds: ["folder"], sessions: [{ projectId: "folder", path: "/s.jsonl" }] })),
      groups: [], activeBoardId: "a" };
    vi.mocked(window.pix!.invoke).mockImplementation(async (route, input) =>
      route === "board.save" ? (input as any).state : {});
    // Selection saves asynchronously; the drag still belongs to the visible A.
    const selecting = boards.select("b");
    const placing = boards.placeNode("folder", "/s.jsonl", "turn", 123, 456);
    await Promise.all([selecting, placing]);
    expect(boards.state.activeBoardId).toBe("b");
    const key = boardNodePositionKey("folder", "/s.jsonl", "turn");
    expect(boards.state.boards[0]!.positions?.[key]).toEqual({ x: 123, y: 456 });
    expect(boards.state.boards[1]!.positions?.[key]).toBeUndefined();
  });

  it("disables canvas mutations without discarding saved canvases", async () => {
    setActivePinia(createPinia()); enableBoards();
    const boards = useBoardStore();
    boards.state = { boards: [{ id: "a", name: "A", groupId: null, projectIds: ["one"] }],
      groups: [], activeBoardId: "a" };
    useLayoutStore().settings!.app.experimentalCanvas = false;
    expect(boards.active).toBeUndefined();
    await boards.addProject("two");
    expect(boards.state.boards[0]!.projectIds).toEqual(["one"]);
    useLayoutStore().settings!.app.experimentalCanvas = true;
    expect(boards.active?.id).toBe("a");
  });

  it("hides another canvas's workspace and Git controls", async () => {
    const pinia = createPinia(); setActivePinia(pinia); enableBoards();
    const boards = useBoardStore();
    boards.state = { boards: [
      { id: "a", name: "A", groupId: null, projectIds: ["local:/one"] },
      { id: "b", name: "B", groupId: null, projectIds: [] },
    ], groups: [], activeBoardId: "b" };
    useWorkspaceStore().project = { name: "One", path: "/one" };
    const wrapper = mount(AppTitlebar, { global: { plugins: [pinia, i18n],
      stubs: { GitBranchPicker: { template: '<div data-test-git />' } } } });
    try {
      expect(wrapper.get('[data-action="workspace-picker"]').text()).not.toContain("One");
      expect(wrapper.find("[data-test-git]").exists()).toBe(false);
      boards.state.activeBoardId = "a";
      await flushPromises();
      expect(wrapper.get('[data-action="workspace-picker"]').text()).toContain("One");
      expect(wrapper.find("[data-test-git]").exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });

  it("renders every folder in the active board as a start point", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const pinia = createPinia(); setActivePinia(pinia); enableBoards();
    useBoardStore().state = { boards: [{ id: "board", name: "Work", groupId: null, projectIds: ["one", "two"],
      sessions: ["a", "b", "c"].map(path => ({ projectId: "one", path })) }], groups: [], activeBoardId: "board" };
    useSessionStore().projects = ["one", "two"].map(id => ({
      id, project: { name: id, path: `/${id}` }, sessions: [], lastOpened: "", connected: true,
    }));
    const wrapper = mount(GraphPanel, { global: { plugins: [pinia, i18n] } });
    try {
      await flushPromises();
      expect(wrapper.findAll(".board-root").map(node => node.text())).toEqual([
        expect.stringContaining("one"), expect.stringContaining("two"),
      ]);
      const flow = (wrapper.findComponent(VueFlow).vm as any).$.exposed;
      const lastTree = flow.findNode(`board:${JSON.stringify(["one", "c", "session"])}`);
      expect(flow.findNode("folder:two").position.y).toBeGreaterThan(lastTree.position.y + 400);
      await wrapper.findAll(".board-root button")[1]!.trigger("click");
      expect(wrapper.emitted("createProjectSession")?.[0]?.[0]).toEqual(useSessionStore().projects[1]);
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });

  it("keeps folder roots on the same canvas when a session graph opens", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const pinia = createPinia(); setActivePinia(pinia); enableBoards();
    const boards = useBoardStore();
    boards.state = { boards: [{ id: "board", name: "Work", groupId: null, projectIds: ["one", "two"],
      positions: { one: { x: 80, y: 80 }, two: { x: 80, y: 290 } } }], groups: [], activeBoardId: "board" };
    const session = useSessionStore();
    session.projects = ["one", "two"].map(id => ({ id, project: { name: id, path: `/${id}` }, sessions: [], lastOpened: "", connected: true }));
    boards.active!.sessions = [{ projectId: "one", path: "/one/s.jsonl" }];
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
      vi.mocked(window.pix!.invoke).mockImplementation(async (route, input) =>
        route === "board.save" ? (input as any).state : {});
      await wrapper.find(`button[title="${i18n.global.t("graph.tidyLayout")}"]`).trigger("click");
      await flushPromises();
      expect(boards.active?.positions).toEqual({});
      expect(flow.findNode("folder:two").position.y).toBeGreaterThan(290);
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });

  it("keeps another folder's session graph and an empty session on the same canvas", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const pinia = createPinia(); setActivePinia(pinia); enableBoards();
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
      const original = session.current;
      wrapper.findComponent(VueFlow).vm.$emit("nodeClick", {
        node: flow.findNode(turnId), event: {},
      });
      expect(session.highlightedNode).toBe(turnId);
      expect(wrapper.emitted("openProjectSession")).toBeUndefined();
      const selectNode = vi.spyOn(session, "selectNode").mockResolvedValue(undefined);
      wrapper.findComponent(VueFlow).vm.$emit("nodeDoubleClick", {
        node: flow.findNode(turnId), event: {},
      });
      expect(wrapper.emitted("openProjectSession")?.at(-1)?.[1]).toBe(other.session.path);
      session.activeProjectId = "two";
      session.current = other;
      await flushPromises();
      expect(selectNode).toHaveBeenCalledWith(other.projection.nodes[0]!.id);
      expect(selectNode).not.toHaveBeenCalledWith(turnId);
      selectNode.mockRestore();
      session.activeProjectId = "one";
      session.current = original;
      await flushPromises();
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
