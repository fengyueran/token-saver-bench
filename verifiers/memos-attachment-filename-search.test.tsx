import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import Attachments from "@/pages/Attachments";
import { useAttachmentLibraryStats } from "@/hooks/useAttachmentLibrary";
import i18n from "@/i18n";
import { AttachmentSchema, MotionMediaSchema, MotionMediaFamily, MotionMediaRole } from "@/types/proto/api/v1/attachment_service_pb";

// Mock only transport/context boundaries. The page, library hooks, categories,
// motion grouping, query pagination and file rows use the real application code.
const f = vi.hoisted(() => ({
  section: "all", filter: undefined as string | undefined,
  space: undefined as string | undefined, creator: "alice",
  list: vi.fn(), remove: vi.fn(), sidebar: vi.fn(),
}));
vi.mock("@/connect", () => ({ attachmentServiceClient: { listAttachments: f.list } }));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ attachmentSection: f.section, setAttachmentSection: f.sidebar }) }));
vi.mock("@/contexts/SpaceContext", () => ({ useSpaceContext: () => ({ memoFilter: f.filter, selectedSpaceName: f.space, creatorUsername: f.creator }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/alice", username: "alice" }) }));
vi.mock("@/hooks/useUserQueries", () => ({ useUsersByNames: () => ({ data: new Map() }) }));
vi.mock("@/hooks/useAttachmentQueries", async (original) => ({
  ...(await original<typeof import("@/hooks/useAttachmentQueries")>()),
  useBatchDeleteAttachments: () => ({ mutateAsync: f.remove, isPending: false }),
}));
vi.mock("@/components/PreviewImageDialog", () => ({ default: (p: { open: boolean; initialIndex: number; items: unknown[] }) =>
  p.open ? <output data-testid="preview-contract">{JSON.stringify({ index: p.initialIndex, items: p.items }, (_key, value) => typeof value === "bigint" ? value.toString() : value)}</output> : null }));

function attachment(filename: string, type = "application/pdf", memo = "memos/one") {
  return create(AttachmentSchema, { name: `attachments/${filename}`, filename, type, memo, creator: "users/alice" });
}
function dataset() {
  const still = attachment("photo.jpg", "image/jpeg");
  still.motionMedia = create(MotionMediaSchema, { family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.STILL, groupId: "pair" });
  const video = attachment("holiday.mov", "video/quicktime");
  video.motionMedia = create(MotionMediaSchema, { family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.VIDEO, groupId: "pair" });
  return [attachment("First.png", "image/png"), still, video, attachment("Budget.PDF"), attachment("voice.mp3", "audio/mpeg")];
}
function StatsProbe() {
  const library = useAttachmentLibraryStats(f.filter);
  return <output data-testid="sidebar-stats">{JSON.stringify(library.stats)}</output>;
}
function mount(showStats = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => <QueryClientProvider client={client}><MemoryRouter><Attachments />{showStats && <StatsProbe />}</MemoryRouter></QueryClientProvider>;
  const view = render(ui());
  return { ...view, refresh: () => view.rerender(ui()) };
}
async function search(value: string) {
  const input = await screen.findByLabelText(/Search loaded attachments|搜索已加载附件/);
  fireEvent.change(input, { target: { value } });
  return input;
}
beforeEach(async () => {
  f.section = "all"; f.filter = undefined; f.space = undefined; f.creator = "alice";
  f.list.mockReset().mockResolvedValue({ attachments: dataset(), nextPageToken: "" });
  f.remove.mockReset().mockResolvedValue(undefined); f.sidebar.mockReset();
  await i18n.changeLanguage("en");
});

it("searches filenames with trimmed case-insensitive text and clears results", async () => {
  mount(); await screen.findByText("Budget.PDF");
  await search("  bUdGeT  ");
  expect(screen.getByText("Budget.PDF")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("voice.mp3")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Clear attachment search|清空附件搜索/ }));
  expect(await screen.findByText("voice.mp3")).toBeInTheDocument();
});

for (const [section, filename, query] of [["media", "First.png", "first"], ["documents", "Budget.PDF", "budget"], ["audio", "voice.mp3", "VOICE"]]) {
  it(`applies search in ${section} and shows an empty result without discarding the query`, async () => {
    f.section = section; mount(); await search(query);
    expect(await screen.findByText(filename)).toBeInTheDocument();
    const input = await search("nothing-matches-this");
    await waitFor(() => expect(screen.queryByText(filename)).not.toBeInTheDocument());
    expect(input).toHaveValue("nothing-matches-this");
  });
}

it("matches the secondary motion filename and previews the clicked filtered item", async () => {
  f.section = "media"; mount(); await search("HOLIDAY");
  expect(await screen.findByText("photo.jpg")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("First.png")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("img", { name: "photo.jpg" }));
  const preview = JSON.parse((await screen.findByTestId("preview-contract")).textContent!);
  expect(preview.items[preview.index].filename).toBe("photo.jpg");
  expect(preview.items[preview.index].kind).toBe("motion");
});

it("retains the query when categories change and clears it when scope changes", async () => {
  const view = mount(); const input = await search("budget");
  f.section = "audio"; view.refresh(); expect(input).toHaveValue("budget");
  expect(screen.queryByText("voice.mp3")).not.toBeInTheDocument();
  f.space = "spaces/team"; f.filter = 'space == "spaces/team"'; view.refresh();
  await waitFor(() => expect(input).toHaveValue(""));
});

it("clears the query when the creator changes", async () => {
  const view = mount(); const input = await search("budget");
  f.creator = "bob"; view.refresh(); await waitFor(() => expect(input).toHaveValue(""));
});

it("filters newly loaded pages without fetching extra pages for a search", async () => {
  f.list.mockImplementation(async (r) => ({ attachments: r.pageToken ? [attachment("NewBudget.pdf")] : dataset(), nextPageToken: r.pageToken ? "" : "next" }));
  mount(); await screen.findByText("Budget.PDF"); await search("budget");
  expect(f.list).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /Load more/i }));
  expect(await screen.findByText("NewBudget.pdf")).toBeInTheDocument();
  expect(screen.queryByText("voice.mp3")).not.toBeInTheDocument();
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(f.list.mock.calls.map(([r]) => r.filter)).toEqual(["", ""]);
});

it("searches unused rows while delete-all retains the original scope and clear confirmation", async () => {
  f.section = "unused";
  const unused = [attachment("unused-match.pdf", "application/pdf", ""), attachment("hidden-unused.pdf", "application/pdf", "")];
  f.list.mockResolvedValue({ attachments: unused, nextPageToken: "" });
  mount(); await screen.findByText("unused-match.pdf"); await search("match");
  await waitFor(() => expect(screen.queryByText("hidden-unused.pdf")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Delete all unused/i }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toMatch(/all|全部/i);
  expect(dialog.textContent).toMatch(/search|搜索/i);
  fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
  await waitFor(() => expect(f.remove).toHaveBeenCalledWith(["attachments/unused-match.pdf", "attachments/hidden-unused.pdf"]));
});

it("does not expose unused deletion in another creator's scope", async () => {
  f.creator = "bob"; f.section = "unused"; mount();
  await waitFor(() => expect(f.sidebar).toHaveBeenCalledWith("all"));
  expect(f.remove).not.toHaveBeenCalled();
});

it("retains the query through loading and applies it when the response arrives", async () => {
  let finish!: (response: { attachments: ReturnType<typeof dataset>; nextPageToken: string }) => void;
  f.list.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mount(); await search("budget");
  expect(screen.queryByText("Budget.PDF")).not.toBeInTheDocument();
  finish({ attachments: dataset(), nextPageToken: "" });
  expect(await screen.findByText("Budget.PDF")).toBeInTheDocument();
  expect(screen.queryByText("voice.mp3")).not.toBeInTheDocument();
});

it("retains search through an error and retries the original scope", async () => {
  f.list.mockRejectedValueOnce(new Error("Synthetic transport failure")).mockResolvedValue({ attachments: dataset(), nextPageToken: "" });
  mount(); await search("budget");
  fireEvent.click(await screen.findByRole("button", { name: /retry|重试/i }));
  expect(await screen.findByText("Budget.PDF")).toBeInTheDocument();
  expect(screen.queryByText("voice.mp3")).not.toBeInTheDocument();
  expect(f.list).toHaveBeenCalledTimes(2);
});

it("preserves complete sidebar totals while filtering page results", async () => {
  mount(true);
  await waitFor(() => expect(JSON.parse(screen.getByTestId("sidebar-stats").textContent!)).toEqual({ media: 2, documents: 1, audio: 1, unused: 0 }));
  await search("budget");
  expect(screen.queryByText("voice.mp3")).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("sidebar-stats").textContent!)).toEqual({ media: 2, documents: 1, audio: 1, unused: 0 });
});

it("keeps the delete-all action available when the unused search has no matches", async () => {
  f.section = "unused";
  f.list.mockResolvedValue({ attachments: [attachment("unused.pdf", "application/pdf", "")], nextPageToken: "" });
  mount(); await screen.findByText("unused.pdf"); await search("no-matches");
  await waitFor(() => expect(screen.queryByText("unused.pdf")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /Delete all unused/i })).toBeInTheDocument();
});

it("provides translated accessible search and clear labels in Chinese", async () => {
  await i18n.changeLanguage("zh-Hans"); mount();
  const input = await screen.findByLabelText("搜索已加载附件");
  fireEvent.change(input, { target: { value: "budget" } });
  expect(screen.getByRole("button", { name: "清空附件搜索" })).toBeInTheDocument();
});
