import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/pages/Home";
import i18n from "@/i18n";
import { useTranslate } from "@/utils/i18n";
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
  confirmMessages: [] as string[],
  confirmApproved: false,
}));

it("resolves actual catalog labels without prescribing implementation translation keys", async () => {
  await i18n.changeLanguage("en");
  const { result } = renderHook(() => useTranslate());
  expect(result.current("common.archive")).toBe("Archive");
});

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
  useSpaceContext: () => ({ memoFilter: fixture.contextFilter, selectedSpaceName: fixture.selectedSpaceName, creatorUsername: "alice" }),
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
vi.mock("react-hot-toast", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-hot-toast")>();
  const toast = Object.assign(vi.fn(), { error: fixture.toastError, success: fixture.toastSuccess });
  return { ...original, default: toast, toast };
});
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

function confirmArchive(count: number) {
  const dialog = screen.queryByRole("dialog");
  if (dialog) {
    expect(dialog).toHaveTextContent(String(count));
    fireEvent.click(within(dialog).getByRole("button", { name: /^(archive|confirm)/i }));
  } else {
    expect(fixture.confirmMessages.at(-1)).toMatch(new RegExp(`\\b${count}\\b`));
    fixture.confirmApproved = true;
    fireEvent.click(screen.getByRole("button", { name: /archive.*selected/i }));
  }
}

describe("bulk archive acceptance", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    fixture.confirmMessages = [];
    fixture.confirmApproved = false;
    vi.spyOn(window, "confirm").mockImplementation((message) => {
      fixture.confirmMessages.push(String(message));
      return fixture.confirmApproved;
    });
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
      expect(screen.queryByRole("checkbox", { name: /memos\/other|Another user.s memo/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-1|First owned memo/i }));
      fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-2|Second owned memo/i }));
      fireEvent.click(screen.getByRole("button", { name: /archive.*selected/i }));
      expect(fixture.updateMemo).not.toHaveBeenCalled();
      confirmArchive(2);
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
    fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-1|First owned memo/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-2|Second owned memo/i }));
    fireEvent.click(screen.getByRole("button", { name: /archive.*selected/i }));
    confirmArchive(2);
    await waitFor(() => {
      const status = screen.queryByRole("status")?.textContent ?? "";
      const toast = fixture.toastError.mock.calls.map(([message]) => String(message)).join(" ");
      expect(`${status} ${toast}`).toMatch(/1.*1/);
    });
    expect(screen.getByRole("checkbox", { name: /memos\/owned-2|Second owned memo/i })).toBeChecked();
    const succeededCheckbox = screen.queryByRole("checkbox", { name: /memos\/owned-1|First owned memo/i });
    if (succeededCheckbox) expect(succeededCheckbox).not.toBeChecked();
  });

  it("clears a pending selection when the Home tag filter changes", async () => {
    const page = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /select memos|批量归档/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /memos\/owned-1|First owned memo/i }));
    fixture.filters = [{ factor: "tagSearch", value: "getting-started" }];
    page.rerenderHome();
    await waitFor(() => {
      for (const checkbox of screen.queryAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    });
    expect(fixture.updateMemo).not.toHaveBeenCalled();
  });
});
