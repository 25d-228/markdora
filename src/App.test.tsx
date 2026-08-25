import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const dialogMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

const fileSystemMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

const pathMocks = vi.hoisted(() => ({
  basename: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  unlisten: vi.fn(),
}));

type CloseEvent = { preventDefault: () => void };
type CloseHandler = (event: CloseEvent) => void | Promise<void>;

let closeHandler: CloseHandler | undefined;

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("@tauri-apps/plugin-fs", () => fileSystemMocks);
vi.mock("@tauri-apps/api/path", () => pathMocks);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: windowMocks.onCloseRequested,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function openDocument(
  path = "C:\\notes\\example.md",
  content = "# Existing document\n",
) {
  dialogMocks.open.mockResolvedValueOnce(path);
  fileSystemMocks.readTextFile.mockResolvedValueOnce(content);

  fireEvent.click(screen.getByRole("button", { name: "Open" }));

  const editor = await screen.findByRole("textbox", {
    name: "Markdown source",
  });
  await waitFor(() => expect(editor).toHaveValue(content));
  return editor;
}

describe("single-document workflow", () => {
  beforeEach(() => {
    closeHandler = undefined;
    dialogMocks.confirm.mockReset().mockResolvedValue(true);
    dialogMocks.open.mockReset().mockResolvedValue(null);
    dialogMocks.save.mockReset().mockResolvedValue(null);
    fileSystemMocks.readTextFile.mockReset();
    fileSystemMocks.writeTextFile.mockReset().mockResolvedValue(undefined);
    pathMocks.basename.mockReset().mockImplementation(async (path: string) => {
      const segments = path.split(/[\\/]/);
      return segments[segments.length - 1] ?? path;
    });
    windowMocks.unlisten.mockReset();
    windowMocks.onCloseRequested
      .mockReset()
      .mockImplementation(async (handler: CloseHandler) => {
        closeHandler = handler;
        return windowMocks.unlisten;
      });
  });

  it("renders the empty shell with document controls and no editor", () => {
    render(<App />);

    expect(screen.getByRole("banner")).toHaveTextContent("Markdora");
    expect(screen.getByRole("button", { name: "New" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.queryByRole("textbox", { name: "Markdown source" }),
    ).not.toBeInTheDocument();

    const workspace = screen.getByRole("main");
    expect(
      within(workspace).getByRole("heading", { name: "No document open" }),
    ).toBeInTheDocument();
    expect(
      within(workspace).getByText(
        "Open or create a Markdown document to begin.",
      ),
    ).toBeInTheDocument();
  });

  it("opens one selected Markdown file with its basename and exact contents", async () => {
    render(<App />);

    const editor = await openDocument(
      "C:\\notes\\meeting.md",
      "# Meeting\n\n- exact text\n",
    );

    expect(editor).toHaveValue("# Meeting\n\n- exact text\n");
    expect(screen.getByText("meeting.md")).toHaveAttribute(
      "title",
      "C:\\notes\\meeting.md",
    );
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(dialogMocks.open).toHaveBeenCalledWith({
      directory: false,
      filters: [{ extensions: ["md"], name: "Markdown" }],
      multiple: false,
      title: "Open Markdown document",
    });
    expect(fileSystemMocks.readTextFile).toHaveBeenCalledWith(
      "C:\\notes\\meeting.md",
    );
  });

  it("derives the Unsaved state from the current and persisted contents", async () => {
    render(<App />);
    const editor = await openDocument();

    fireEvent.change(editor, { target: { value: "Changed" } });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.change(editor, {
      target: { value: "# Existing document\n" },
    });

    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the exact path and buffer, clearing Unsaved only after success", async () => {
    const write = deferred<void>();
    fileSystemMocks.writeTextFile.mockReturnValueOnce(write.promise);
    render(<App />);
    const editor = await openDocument("C:\\notes\\draft.md", "draft");
    fireEvent.change(editor, { target: { value: "ready\n" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fileSystemMocks.writeTextFile).toHaveBeenCalledWith(
        "C:\\notes\\draft.md",
        "ready\n",
      ),
    );
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    write.resolve();

    await waitFor(() =>
      expect(screen.queryByText("Unsaved")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps edits made during a save dirty after the captured buffer is written", async () => {
    const write = deferred<void>();
    fileSystemMocks.writeTextFile.mockReturnValueOnce(write.promise);
    render(<App />);
    const editor = await openDocument("C:\\notes\\draft.md", "draft");
    fireEvent.change(editor, { target: { value: "first edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fileSystemMocks.writeTextFile).toHaveBeenCalled());

    expect(editor).toBeEnabled();
    fireEvent.change(editor, { target: { value: "edit made during save" } });
    write.resolve();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(editor).toHaveValue("edit made during save");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("preserves the buffer and Unsaved state after a failed save", async () => {
    fileSystemMocks.writeTextFile.mockRejectedValueOnce(
      new Error("disk is read-only"),
    );
    render(<App />);
    const editor = await openDocument();
    fireEvent.change(editor, { target: { value: "important changes" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save the document: disk is read-only",
    );
    expect(editor).toHaveValue("important changes");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    fileSystemMocks.writeTextFile.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("protects the editor while New writes before replacing the document", async () => {
    const write = deferred<void>();
    fileSystemMocks.writeTextFile.mockReturnValueOnce(write.promise);
    render(<App />);
    const editor = await openDocument("C:\\notes\\old.md", "old contents");
    fireEvent.change(editor, { target: { value: "unsaved old contents" } });
    dialogMocks.save.mockResolvedValueOnce("C:\\notes\\untitled.md");

    fireEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() =>
      expect(fileSystemMocks.writeTextFile).toHaveBeenCalledWith(
        "C:\\notes\\untitled.md",
        "",
      ),
    );
    expect(editor).toHaveValue("unsaved old contents");
    expect(screen.getByText("old.md")).toBeInTheDocument();
    expect(editor).toBeDisabled();

    write.resolve();

    await waitFor(() => expect(editor).toHaveValue(""));
    expect(editor).toBeEnabled();
    expect(screen.getByText("untitled.md")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(dialogMocks.save).toHaveBeenCalledWith({
      defaultPath: "untitled.md",
      filters: [{ extensions: ["md"], name: "Markdown" }],
      title: "Create Markdown document",
    });
  });

  it("protects the editor while Open reads before replacing the document", async () => {
    const read = deferred<string>();
    render(<App />);
    const editor = await openDocument("C:\\notes\\old.md", "old contents");
    fireEvent.change(editor, { target: { value: "unsaved old contents" } });
    dialogMocks.open.mockResolvedValueOnce("C:\\notes\\replacement.md");
    fileSystemMocks.readTextFile.mockReturnValueOnce(read.promise);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(fileSystemMocks.readTextFile).toHaveBeenCalledWith(
        "C:\\notes\\replacement.md",
      ),
    );
    expect(editor).toHaveValue("unsaved old contents");
    expect(screen.getByText("old.md")).toBeInTheDocument();
    expect(editor).toBeDisabled();

    read.resolve("replacement contents");

    await waitFor(() => expect(editor).toHaveValue("replacement contents"));
    expect(editor).toBeEnabled();
    expect(screen.getByText("replacement.md")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("leaves a dirty document unchanged when open or create is canceled", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\keep.md", "original");
    fireEvent.change(editor, { target: { value: "keep this edit" } });
    dialogMocks.open.mockResolvedValueOnce(null);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(dialogMocks.open).toHaveBeenCalledTimes(2));
    expect(editor).toHaveValue("keep this edit");

    dialogMocks.save.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await waitFor(() => expect(dialogMocks.save).toHaveBeenCalledOnce());

    expect(editor).toHaveValue("keep this edit");
    expect(screen.getByText("keep.md")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(fileSystemMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("blocks New and Open when discarding dirty changes is rejected", async () => {
    render(<App />);
    const editor = await openDocument();
    fireEvent.change(editor, { target: { value: "do not discard" } });
    dialogMocks.confirm.mockResolvedValue(false);

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await waitFor(() => expect(dialogMocks.confirm).toHaveBeenCalledOnce());
    expect(dialogMocks.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(dialogMocks.confirm).toHaveBeenCalledTimes(2));

    expect(dialogMocks.open).toHaveBeenCalledOnce();
    expect(editor).toHaveValue("do not discard");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("does not replace a dirty document after read or create failure", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\safe.md", "safe");
    fireEvent.change(editor, { target: { value: "unsaved safe text" } });
    dialogMocks.open.mockResolvedValueOnce("C:\\notes\\broken.md");
    fileSystemMocks.readTextFile.mockRejectedValueOnce(new Error("invalid UTF-8"));

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open the document: invalid UTF-8",
    );
    expect(editor).toHaveValue("unsaved safe text");
    expect(screen.getByText("safe.md")).toBeInTheDocument();

    dialogMocks.save.mockResolvedValueOnce("C:\\notes\\new.md");
    fileSystemMocks.writeTextFile.mockRejectedValueOnce(new Error("access denied"));
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not create the document: access denied",
      ),
    );
    expect(editor).toHaveValue("unsaved safe text");
    expect(screen.getByText("safe.md")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("prevents duplicate native operations while one is pending", async () => {
    const selection = deferred<string | null>();
    dialogMocks.open.mockReturnValueOnce(selection.promise);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    expect(dialogMocks.open).toHaveBeenCalledOnce();
    expect(dialogMocks.save).not.toHaveBeenCalled();
    selection.resolve(null);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open" })).toBeEnabled(),
    );
  });

  it("protects dirty window closes and cleans up one stable listener", async () => {
    const { unmount } = render(<App />);
    await waitFor(() => expect(closeHandler).toBeDefined());
    const editor = await openDocument();

    const cleanCloseEvent = { preventDefault: vi.fn() };
    await closeHandler?.(cleanCloseEvent);
    expect(dialogMocks.confirm).not.toHaveBeenCalled();
    expect(cleanCloseEvent.preventDefault).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: "dirty" } });
    dialogMocks.confirm.mockResolvedValueOnce(false);
    const rejectedCloseEvent = { preventDefault: vi.fn() };
    await closeHandler?.(rejectedCloseEvent);

    expect(dialogMocks.confirm).toHaveBeenCalledWith(
      "Discard unsaved changes and close this document?",
      {
        cancelLabel: "Keep editing",
        kind: "warning",
        okLabel: "Discard changes",
        title: "Unsaved changes",
      },
    );
    expect(rejectedCloseEvent.preventDefault).toHaveBeenCalledOnce();

    dialogMocks.confirm.mockResolvedValueOnce(true);
    const acceptedCloseEvent = { preventDefault: vi.fn() };
    await closeHandler?.(acceptedCloseEvent);
    expect(acceptedCloseEvent.preventDefault).not.toHaveBeenCalled();
    expect(windowMocks.onCloseRequested).toHaveBeenCalledOnce();

    unmount();
    expect(windowMocks.unlisten).toHaveBeenCalledOnce();
  });
});
