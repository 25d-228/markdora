import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const coreMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn(),
  invoke: vi.fn(),
}));

const openerMocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
}));

type CloseEvent = { preventDefault: () => void };
type CloseHandler = (event: CloseEvent) => void | Promise<void>;

let closeHandler: CloseHandler | undefined;

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("@tauri-apps/plugin-fs", () => fileSystemMocks);
vi.mock("@tauri-apps/api/path", () => pathMocks);
vi.mock("@tauri-apps/api/core", () => coreMocks);
vi.mock("@tauri-apps/plugin-opener", () => openerMocks);
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

  const editor = (await screen.findByRole("textbox", {
    name: "Markdown source",
  })) as HTMLTextAreaElement;
  await waitFor(() => expect(editor).toHaveValue(content));
  return editor;
}

function openFindAndReplace() {
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  return screen.getByRole("textbox", { name: "Find" });
}

describe("single-document workflow", () => {
  beforeEach(() => {
    closeHandler = undefined;
    dialogMocks.confirm.mockReset().mockResolvedValue(true);
    dialogMocks.open.mockReset().mockResolvedValue(null);
    dialogMocks.save.mockReset().mockResolvedValue(null);
    fileSystemMocks.readTextFile.mockReset();
    fileSystemMocks.writeTextFile.mockReset().mockResolvedValue(undefined);
    coreMocks.convertFileSrc
      .mockReset()
      .mockImplementation((path: string) => `asset://${path}`);
    coreMocks.invoke.mockReset();
    openerMocks.openUrl.mockReset().mockResolvedValue(undefined);
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
    expect(screen.queryByRole("button", { name: "Find" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "View mode" })).not.toBeInTheDocument();
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

  it("switches Edit, Preview, and Split without changing the buffer or dirty state", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\modes.md", "original");
    const editButton = screen.getByRole("button", { name: "Edit" });
    const splitButton = screen.getByRole("button", { name: "Split" });
    const previewButton = screen.getByRole("button", { name: "Preview" });
    const viewModeControl = screen.getByRole("group", { name: "View mode" });

    expect(within(viewModeControl).getAllByRole("button")).toHaveLength(3);
    expect(editButton).toHaveAttribute("aria-pressed", "true");
    expect(splitButton).toHaveAttribute("aria-pressed", "false");
    expect(previewButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Markdown preview" })).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "# Unsaved heading" } });
    fireEvent.click(previewButton);

    expect(screen.queryByRole("textbox", { name: "Markdown source" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Markdown preview" })).toHaveTextContent(
      "Unsaved heading",
    );
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(previewButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(splitButton);

    expect(screen.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
      "# Unsaved heading",
    );
    expect(screen.getByRole("region", { name: "Markdown preview" })).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("opens Find for an active document and returns focus to the editor when closed", async () => {
    render(<App />);
    const editor = await openDocument();

    const findInput = openFindAndReplace();

    expect(screen.getByRole("region", { name: "Find and replace" })).toBeInTheDocument();
    expect(findInput).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Replace with" })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Close find and replace" }),
    );

    expect(
      screen.queryByRole("region", { name: "Find and replace" }),
    ).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it("opens Find from Preview in Edit without changing the buffer or dirty state", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\find.md", "original");
    fireEvent.change(editor, { target: { value: "unsaved source" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    openFindAndReplace();

    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
      "unsaved source",
    );
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(screen.getByRole("region", { name: "Find and replace" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      screen.queryByRole("region", { name: "Find and replace" }),
    ).not.toBeInTheDocument();
  });

  it("finds mixed-case text and regular-expression characters literally", async () => {
    render(<App />);
    const editor = await openDocument(
      "C:\\notes\\literal.md",
      "Test test TEST .*?[]()\\^$ and .*?[]()\\^$",
    );
    const findInput = openFindAndReplace();

    fireEvent.change(findInput, { target: { value: "test" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3");
    expect(findInput).toHaveFocus();
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(4);

    fireEvent.change(findInput, { target: { value: ".*?[]()\\^$" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
    expect(findInput).toHaveFocus();
    expect(editor.selectionStart).toBe(15);
    expect(editor.selectionEnd).toBe(25);
  });

  it("wraps match navigation and selects exact source ranges", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\matches.md", "one ONE one");
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "one" } });

    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(8);
    expect(editor.selectionEnd).toBe(11);

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(4);
    expect(editor.selectionEnd).toBe(7);
  });

  it("reports empty and unmatched queries and disables invalid actions", async () => {
    render(<App />);
    await openDocument("C:\\notes\\none.md", "source");
    const findInput = openFindAndReplace();
    const actionNames = [
      "Previous match",
      "Next match",
      "Replace",
      "Replace all",
    ];

    expect(screen.getByRole("status")).toHaveTextContent("Enter text to find");
    for (const name of actionNames) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }

    fireEvent.change(findInput, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    for (const name of actionNames) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("replaces one active range, permits deletion, and skips inserted matches", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\replace.md", "a middle a");
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "a" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "aa" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(editor).toHaveValue("aa middle a");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(10);
    expect(editor.selectionEnd).toBe(11);

    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(editor).toHaveValue("aa middle ");
  });

  it("replaces all from one snapshot without recursively replacing inserted text", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\all.md", "a-A! keep");
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "a" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "aa" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));

    expect(editor).toHaveValue("aa-aa! keep");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 4");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(1);
    expect(fileSystemMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("clears Unsaved when a replacement restores the persisted buffer", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\restore.md", "original");
    fireEvent.change(editor, { target: { value: "changed" } });
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "changed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "original" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(editor).toHaveValue("original");
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("updates Split preview and dirty state without writing until Save", async () => {
    render(<App />);
    await openDocument("C:\\notes\\preview-find.md", "# Old heading");
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "Old" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "New" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(
      screen.getByRole("heading", { name: "New heading" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(fileSystemMocks.writeTextFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fileSystemMocks.writeTextFile).toHaveBeenCalledWith(
        "C:\\notes\\preview-find.md",
        "# New heading",
      ),
    );
  });

  it("keeps a replacement made during Save unsaved after the captured write", async () => {
    const write = deferred<void>();
    fileSystemMocks.writeTextFile.mockReturnValueOnce(write.promise);
    render(<App />);
    const editor = await openDocument("C:\\notes\\save-find.md", "A A");
    fireEvent.change(editor, { target: { value: "B A" } });
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "C" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fileSystemMocks.writeTextFile).toHaveBeenCalledWith(
        "C:\\notes\\save-find.md",
        "B A",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(editor).toHaveValue("B C");
    await act(async () => {
      write.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(editor).toHaveValue("B C");

    fireEvent.change(editor, { target: { value: "B A" } });
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("clears Find only after successful document replacement", async () => {
    render(<App />);
    await openDocument("C:\\notes\\old.md", "old text");
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "old" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "new" },
    });

    dialogMocks.save.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await waitFor(() => expect(dialogMocks.save).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("old");

    dialogMocks.open.mockResolvedValueOnce("C:\\notes\\broken.md");
    fileSystemMocks.readTextFile.mockRejectedValueOnce(new Error("cannot read"));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot read");
    expect(screen.getByRole("textbox", { name: "Replace with" })).toHaveValue(
      "new",
    );

    dialogMocks.open.mockResolvedValueOnce("C:\\notes\\next.md");
    fileSystemMocks.readTextFile.mockResolvedValueOnce("next text");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByText("next.md");
    expect(
      screen.queryByRole("region", { name: "Find and replace" }),
    ).not.toBeInTheDocument();

    const clearedFindInput = openFindAndReplace();
    expect(clearedFindInput).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Replace with" })).toHaveValue("");
  });

  it("recomputes matches after manual edits without selecting a stale range", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\edit-find.md", "cat xx cat");
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "cat" } });
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(editor.selectionStart).toBe(7);

    fireEvent.change(editor, { target: { value: "cat yy dog cat" } });

    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    expect(editor.selectionStart).toBe(11);
    expect(editor.selectionEnd).toBe(14);
  });

  it("disables Find editing while a document replacement is pending", async () => {
    const read = deferred<string>();
    render(<App />);
    await openDocument("C:\\notes\\pending.md", "find this");
    const findInput = openFindAndReplace();
    fireEvent.change(findInput, { target: { value: "find" } });
    dialogMocks.open.mockResolvedValueOnce("C:\\notes\\next.md");
    fileSystemMocks.readTextFile.mockReturnValueOnce(read.promise);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(findInput).toBeDisabled());

    expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Replace with" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous match" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace all" })).toBeDisabled();

    read.reject(new Error("cannot read"));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot read");
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("find");
    expect(findInput).toBeEnabled();
  });

  it("updates a GitHub-Flavored Markdown preview from unsaved source edits", async () => {
    render(<App />);
    const editor = await openDocument("C:\\notes\\preview.md", "start");
    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    fireEvent.change(editor, {
      target: {
        value: [
          "# Live heading",
          "",
          "~~removed~~ and `inline code`",
          "",
          "| Name | Value |",
          "| --- | --- |",
          "| One | Two |",
          "",
          "- [ ] pending task",
          "",
          "```text",
          "line one",
          "  line two",
          "```",
        ].join("\n"),
      },
    });

    const preview = screen.getByRole("region", { name: "Markdown preview" });
    expect(within(preview).getByRole("heading", { name: "Live heading" })).toBeInTheDocument();
    expect(within(preview).getByText("removed").tagName).toBe("DEL");
    expect(within(preview).getByRole("table")).toBeInTheDocument();
    expect(within(preview).getByRole("checkbox")).toBeDisabled();
    expect(within(preview).getByText("inline code").tagName).toBe("CODE");
    expect(within(preview).getByText(/line one/)).toHaveTextContent("line two");
  });

  it("renders an empty active document as an empty preview", async () => {
    render(<App />);
    await openDocument("C:\\notes\\empty.md", "");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("region", { name: "Markdown preview" })).toBeEmptyDOMElement();
    expect(screen.queryByText("No document open")).not.toBeInTheDocument();
  });

  it("does not turn raw HTML into active preview elements", async () => {
    render(<App />);
    await openDocument(
      "C:\\notes\\unsafe.md",
      "Before\n\n<script>alert(1)</script><iframe title=\"unsafe\"></iframe><style>body{display:none}</style><button onclick=\"alert(1)\">Unsafe</button>\n\nAfter",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const preview = screen.getByRole("region", { name: "Markdown preview" });
    expect(preview).toHaveTextContent("Before");
    expect(preview).toHaveTextContent("After");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("iframe")).toBeNull();
    expect(preview.querySelector("style")).toBeNull();
    expect(preview.querySelector("button")).toBeNull();
    expect(preview.querySelector("[onclick]")).toBeNull();
  });

  it("opens approved external links outside the webview and blocks other destinations", async () => {
    render(<App />);
    await openDocument(
      "C:\\notes\\links.md",
      "[Website](https://example.com) [Email](mailto:hello@example.com) [Script](javascript:alert(1)) [VBScript](vbscript:msgbox(1)) [Data](data:text/html,bad) [File](file:///tmp/bad) [Protocol relative](//example.com) [Relative](other.md)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const locationBeforeClick = window.location.href;
    const websiteLink = screen.getByRole("link", { name: "Website" });
    const emailLink = screen.getByRole("link", { name: "Email" });

    expect(websiteLink.tagName).not.toBe("A");
    expect(websiteLink).not.toHaveAttribute("href");
    expect(
      fireEvent(
        websiteLink,
        new MouseEvent("auxclick", {
          bubbles: true,
          button: 1,
          cancelable: true,
        }),
      ),
    ).toBe(false);
    expect(fireEvent.contextMenu(websiteLink)).toBe(false);
    expect(openerMocks.openUrl).not.toHaveBeenCalled();

    fireEvent.keyDown(websiteLink, { key: "Enter" });
    await waitFor(() =>
      expect(openerMocks.openUrl).toHaveBeenCalledWith("https://example.com"),
    );
    fireEvent.click(emailLink);
    await waitFor(() =>
      expect(openerMocks.openUrl).toHaveBeenCalledWith("mailto:hello@example.com"),
    );
    expect(window.location.href).toBe(locationBeforeClick);
    expect(screen.queryByRole("link", { name: "Script" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "VBScript" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "File" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Protocol relative" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Relative" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Script"));
    fireEvent.click(screen.getByText("Relative"));
    expect(openerMocks.openUrl).toHaveBeenCalledTimes(2);
  });

  it("shows an opener failure without replacing the active preview", async () => {
    openerMocks.openUrl.mockRejectedValueOnce(new Error("handler unavailable"));
    render(<App />);
    await openDocument(
      "C:\\notes\\links.md",
      "# Keep this\n\n[Website](https://example.com)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("link", { name: "Website" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open the external link: handler unavailable",
    );
    expect(screen.getByText("links.md")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Markdown preview" })).toHaveTextContent(
      "Keep this",
    );
  });

  it("keeps document and external-link errors independent", async () => {
    fileSystemMocks.writeTextFile.mockRejectedValueOnce(
      new Error("disk is read-only"),
    );
    openerMocks.openUrl
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("handler unavailable"))
      .mockResolvedValueOnce(undefined);
    render(<App />);
    const editor = await openDocument(
      "C:\\notes\\links.md",
      "[Website](https://example.com)",
    );
    fireEvent.change(editor, {
      target: { value: "[Website](https://example.com)\n\nUnsaved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const documentError = await screen.findByText(
      "Could not save the document: disk is read-only",
    );
    const websiteLink = screen.getByRole("link", { name: "Website" });

    fireEvent.click(websiteLink);
    await waitFor(() => expect(openerMocks.openUrl).toHaveBeenCalledTimes(1));
    expect(documentError).toBeInTheDocument();

    fireEvent.click(websiteLink);
    expect(
      await screen.findByText(
        "Could not open the external link: handler unavailable",
      ),
    ).toBeInTheDocument();
    expect(documentError).toBeInTheDocument();

    fireEvent.click(websiteLink);
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Could not open the external link: handler unavailable",
        ),
      ).not.toBeInTheDocument(),
    );
    expect(documentError).toBeInTheDocument();
  });

  it("authorizes valid relative images and preserves alt text when unavailable", async () => {
    coreMocks.invoke.mockImplementation(
      (_command: string, argumentsValue: { imageSource: string }) =>
        argumentsValue.imageSource === "images/diagram.png"
          ? Promise.resolve("C:\\notes\\images\\diagram.png")
          : Promise.reject(new Error("missing")),
    );
    render(<App />);
    await openDocument(
      "C:\\notes\\images.md",
      "![Diagram](images/diagram.png \"Diagram title\") ![Missing](images/missing.jpg)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
        "src",
        "asset://C:\\notes\\images\\diagram.png",
      ),
    );
    const image = screen.getByRole("img", { name: "Diagram" });
    expect(coreMocks.invoke).toHaveBeenCalledWith("authorize_preview_image", {
      documentPath: "C:\\notes\\images.md",
      imageSource: "images/diagram.png",
    });
    expect(coreMocks.convertFileSrc).toHaveBeenCalledWith(
      "C:\\notes\\images\\diagram.png",
    );
    expect(image).toHaveAttribute("title", "Diagram title");
    expect(await screen.findByRole("img", { name: "Missing" })).toHaveTextContent(
      "Missing",
    );
  });

  it("keeps an unchanged local image authorized across unrelated source edits", async () => {
    coreMocks.invoke.mockResolvedValueOnce("C:\\notes\\images\\diagram.png");
    render(<App />);
    const editor = await openDocument(
      "C:\\notes\\images.md",
      "![Diagram](images/diagram.png)\n\nOriginal text",
    );
    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
        "src",
        "asset://C:\\notes\\images\\diagram.png",
      ),
    );
    const image = screen.getByRole("img", { name: "Diagram" });

    fireEvent.change(editor, {
      target: {
        value: "![Diagram](images/diagram.png)\n\nChanged text",
      },
    });

    expect(screen.getByRole("img", { name: "Diagram" })).toBe(image);
    expect(coreMocks.invoke).toHaveBeenCalledOnce();
  });

  it("does not authorize remote, absolute, traversal, or unsupported images", async () => {
    render(<App />);
    await openDocument(
      "C:\\notes\\blocked.md",
      [
        "![Remote](https://example.com/image.png)",
        "![Absolute](/tmp/image.png)",
        "![Traversal](../image.png)",
        "![Unsupported](images/image.svg)",
      ].join("\n"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    for (const name of ["Remote", "Absolute", "Traversal", "Unsupported"]) {
      expect(screen.getByRole("img", { name })).toHaveTextContent(name);
    }
    expect(coreMocks.invoke).not.toHaveBeenCalled();
  });

  it("ignores a stale local-image authorization result", async () => {
    const oldImage = deferred<string>();
    const newImage = deferred<string>();
    coreMocks.invoke.mockImplementation(
      (_command: string, argumentsValue: { imageSource: string }) =>
        argumentsValue.imageSource === "images/old.png"
          ? oldImage.promise
          : newImage.promise,
    );
    render(<App />);
    const editor = await openDocument(
      "C:\\notes\\stale.md",
      "![Old image](images/old.png)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(coreMocks.invoke).toHaveBeenCalledOnce());

    fireEvent.change(editor, { target: { value: "![New image](images/new.png)" } });
    await waitFor(() => expect(coreMocks.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      oldImage.resolve("C:\\notes\\images\\old.png");
    });

    expect(coreMocks.convertFileSrc).not.toHaveBeenCalledWith(
      "C:\\notes\\images\\old.png",
    );
    newImage.resolve("C:\\notes\\images\\new.png");

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "New image" })).toHaveAttribute(
        "src",
        "asset://C:\\notes\\images\\new.png",
      ),
    );
    expect(screen.queryByRole("img", { name: "Old image" })).not.toBeInTheDocument();
  });

  it("ignores an image result from another document with the same source", async () => {
    const firstImage = deferred<string>();
    const secondImage = deferred<string>();
    coreMocks.invoke
      .mockReturnValueOnce(firstImage.promise)
      .mockReturnValueOnce(secondImage.promise);
    render(<App />);
    await openDocument(
      "C:\\notes\\first.md",
      "![Shared image](images/shared.png)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(coreMocks.invoke).toHaveBeenCalledOnce());

    dialogMocks.open.mockResolvedValueOnce("C:\\other\\second.md");
    fileSystemMocks.readTextFile.mockResolvedValueOnce(
      "![Shared image](images/shared.png)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByText("second.md");
    await waitFor(() => expect(coreMocks.invoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstImage.resolve("C:\\notes\\images\\shared.png");
    });
    expect(coreMocks.convertFileSrc).not.toHaveBeenCalledWith(
      "C:\\notes\\images\\shared.png",
    );

    secondImage.resolve("C:\\other\\images\\shared.png");
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Shared image" })).toHaveAttribute(
        "src",
        "asset://C:\\other\\images\\shared.png",
      ),
    );
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

  it("blocks close while a save can change the persisted baseline", async () => {
    const write = deferred<void>();
    fileSystemMocks.writeTextFile.mockReturnValueOnce(write.promise);
    render(<App />);
    await waitFor(() => expect(closeHandler).toBeDefined());
    const editor = await openDocument("C:\\notes\\draft.md", "A");
    fireEvent.change(editor, { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fileSystemMocks.writeTextFile).toHaveBeenCalledWith(
        "C:\\notes\\draft.md",
        "B",
      ),
    );

    fireEvent.change(editor, { target: { value: "A" } });
    const closeEvent = { preventDefault: vi.fn() };
    await closeHandler?.(closeEvent);

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dialogMocks.confirm).not.toHaveBeenCalled();

    write.resolve();

    await waitFor(() => expect(screen.getByText("Unsaved")).toBeInTheDocument());
    expect(editor).toHaveValue("A");
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
