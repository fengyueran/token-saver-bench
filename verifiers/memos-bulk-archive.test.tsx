import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/pages/Home";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const fixture = vi.hoisted(() => ({
  memos: [] as Memo[],
  data: { pages: [] as Array<{ memos: Memo[]; nextPageToken: string }> },
  filters: [] as Array<{ factor: string; value: string }>,
  updateMemo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  maxColumns: 1 as 0 | 1,
  selectedSpaceName: undefined as string | undefined,
  contextFilter: undefined as string | undefined,
}));

vi.mock("@/hooks/useMemoQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMemoQueries")>()),
  useInfiniteMemos: () => ({
    data: fixture.data,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateMemo: () => ({ mutateAsync: fixture.updateMemo }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isUserSettingsInitialized: true, userTagsSetting: {}, memoRelatedSetting: { reactions: [] } }),
}));
vi.mock("@/contexts/GlobalMemoEditorContext", () => ({
  useGlobalMemoEditor: () => ({ claimHomeAutoFocus: false }),
}));
vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/MemoFilterContext")>()),
  useMemoFilterContext: () => ({ filters: fixture.filters, memoView: undefined, removeFilter: vi.fn() }),
}));
vi.mock("@/contexts/SpaceContext", () => ({
  useSpaceContext: () => ({ memoFilter: fixture.contextFilter, selectedSpaceName: fixture.selectedSpaceName, creatorUsername: undefined }),
}));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ setQuickFindOpen: vi.fn() }) }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ profile: { instanceUrl: "" }, memoRelatedSetting: { reactions: [] } }) }));
vi.mock("@/contexts/ViewContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/ViewContext")>()),
  useView: () => ({ maxColumns: fixture.maxColumns, compactMode: false }),
  useLinkPreviewEnabled: () => false,
}));
vi.mock("@/hooks", () => ({
  useMemoFilters: () => JSON.stringify(fixture.filters),
  useMemoSorting: () => ({ listSort: undefined, orderBy: "create_time desc" }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice", username: "alice" }) }));
vi.mock("@/hooks/useMemoSuggestions", () => ({ useMemoSuggestions: () => [] }));
vi.mock("react-hot-toast", () => ({ default: { error: fixture.toastError, success: fixture.toastSuccess } }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, values?: Record<string, number | string>) => {
    const messages: Record<string, string> = {
      "memo.select-memos": "Select memos",
      "memo.cancel-selection": "Cancel selection",
      "memo.select-memo": "Select memo {{name}}",
      "memo.archive-selected": "Archive selected {{count}}",
      "memo.confirm-archive-title": "Archive selected memos?",
      "memo.confirm-archive-description": "Archive {{count}} selected memos?",
      "memo.confirm-archive": "Archive selected memos",
      "memo.cancel-archive": "Cancel",
      "memo.bulk-archive-result": "{{succeeded}} succeeded, {{failed}} failed",
      "memo.bulk-archive.enter": "Select memos",
      "memo.bulk-archive.cancel": "Cancel selection",
      "memo.bulk-archive.cancel-confirm": "Cancel",
      "memo.bulk-archive.select-memo": "Select memo {{name}}",
      "memo.bulk-archive.archive-selected": "Archive {{count}} selected memos",
      "memo.bulk-archive.confirm-title": "Archive selected memos?",
      "memo.bulk-archive.confirm-description": "Archive {{count}} selected memos?",
      "memo.bulk-archive.confirm": "Archive {{count}} memos",
      "memo.bulk-archive.partial-result": "{{succeeded}} succeeded, {{failed}} failed",
    };
    return (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ""));
  },
}));
vi.mock("@/components/MemoEditor", () => ({ default: () => null }));
vi.mock("@/components/MemoContent/MentionResolutionContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/MemoContent/MentionResolutionContext")>()),
  MentionResolutionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useResolvedUser: () => undefined,
}));
vi.mock("@/components/MemoFilters", () => ({ default: () => null }));

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(ui());
  return { ...rendered, rerenderHome: () => rendered.rerender(ui()) };
}

describe("bulk archive acceptance", () => {
  beforeEach(() => {
    fixture.memos = [
      create(MemoSchema, { name: "memos/owned-1", content: "First owned memo", creator: "users/alice", state: State.NORMAL }),
      create(MemoSchema, { name: "memos/owned-2", content: "Second owned memo", creator: "users/alice", state: State.NORMAL }),
      create(MemoSchema, { name: "memos/other", content: "Another user's memo", creator: "users/bob", state: State.NORMAL }),
    ];
    fixture.data = { pages: [{ memos: fixture.memos, nextPageToken: "" }] };
    fixture.maxColumns = 1;
    fixture.selectedSpaceName = undefined;
    fixture.contextFilter = undefined;
    fixture.updateMemo.mockReset().mockResolvedValue(undefined);
    fixture.toastError.mockReset();
    fixture.toastSuccess.mockReset();
  });

  it("offers an accessible way to start selecting memos on Home", () => {
    renderHome();
    expect(screen.queryByRole("button", { name: /select memos|批量归档/i })).toBeInTheDocument();
  });

  it.each([1, 0] as const)("archives only the two selected owned memos in layout %i", async (columns) => {
    fixture.maxColumns = columns;
    const widthSpy = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1200);
    try {
      renderHome();
      fireEvent.click(screen.getByRole("button", { name: /select memos|批量归档/i }));
      expect(screen.queryByRole("checkbox", { name: /memos\/other/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-1/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-2/ }));
      fireEvent.click(screen.getByRole("button", { name: /archive.*selected/i }));
      expect(fixture.updateMemo).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog", { name: /archive.*memos|confirm archive/i });
      expect(dialog).toHaveTextContent("2");
      fireEvent.click(within(dialog).getByRole("button", { name: /^(archive|confirm)/i }));
      await waitFor(() => expect(fixture.updateMemo).toHaveBeenCalledTimes(2));
      expect(fixture.updateMemo.mock.calls).toEqual(
        expect.arrayContaining([
          [{ update: { name: "memos/owned-1", state: State.ARCHIVED }, updateMask: ["state"] }],
          [{ update: { name: "memos/owned-2", state: State.ARCHIVED }, updateMask: ["state"] }],
        ]),
      );
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("keeps failed memos selectable and reports a partial failure", async () => {
    fixture.updateMemo.mockImplementation(async ({ update }: { update: { name: string } }) => {
      if (update.name === "memos/owned-2") throw new Error("controlled failure");
    });
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: /select memos|批量归档/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-2/ }));
    fireEvent.click(screen.getByRole("button", { name: /archive.*selected/i }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /archive.*memos|confirm archive/i })).getByRole("button", { name: /^(archive|confirm)/i }));
    await waitFor(() => {
      const status = screen.queryByRole("status")?.textContent ?? "";
      const toast = fixture.toastError.mock.calls.map(([message]) => String(message)).join(" ");
      expect(`${status} ${toast}`).toMatch(/1.*1/);
    });
    expect(screen.getByRole("checkbox", { name: /memos\/owned-2/ })).toBeChecked();
    const succeededCheckbox = screen.queryByRole("checkbox", { name: /memos\/owned-1/ });
    if (succeededCheckbox) expect(succeededCheckbox).not.toBeChecked();
  });

  it("clears a pending selection when the Home tag filter changes", async () => {
    const page = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /select memos|批量归档/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-1/ }));
    fixture.filters = [{ factor: "tagSearch", value: "getting-started" }];
    page.rerenderHome();
    await waitFor(() => expect(screen.queryByRole("button", { name: /select memos|批量归档/i })).toBeInTheDocument());
    expect(fixture.updateMemo).not.toHaveBeenCalled();
  });
});
