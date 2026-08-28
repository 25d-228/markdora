import { basename } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownPreview } from "@/MarkdownPreview";

type DocumentState = {
  content: string;
  name: string;
  path: string;
  persistedContent: string;
};

type ViewMode = "edit" | "split" | "preview";

type MatchRange = {
  end: number;
  start: number;
};

type ShortcutAction = "new" | "open" | "save" | "saveAs";

type ScrollPane = "preview" | "source";

type PendingScrollOffsets = Record<ScrollPane, number | null>;

const markdownFilter = [{ name: "Markdown", extensions: ["md"] }];

const discardDialogOptions = {
  title: "Unsaved changes",
  kind: "warning" as const,
  okLabel: "Discard changes",
  cancelLabel: "Keep editing",
};

function describeError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return "Unknown error";
}

function findLiteralMatches(content: string, query: string) {
  if (!query) {
    return [];
  }

  const matches: MatchRange[] = [];
  const normalizedQuery = query.toLowerCase();
  let position = 0;

  while (position <= content.length - query.length) {
    const candidate = content.slice(position, position + query.length);
    if (candidate.toLowerCase() === normalizedQuery) {
      matches.push({ start: position, end: position + query.length });
      position += query.length;
    } else {
      position += 1;
    }
  }

  return matches;
}

function findMatchAtOrAfter(matches: MatchRange[], position: number) {
  return matches.find((match) => match.start >= position) ?? matches[0] ?? null;
}

function scrollDistance(element: HTMLElement) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function clampScrollOffset(offset: number, maximum: number) {
  if (!Number.isFinite(offset)) {
    return 0;
  }

  return Math.min(maximum, Math.max(0, offset));
}

function scrollProgress(element: HTMLElement) {
  const distance = scrollDistance(element);
  if (distance === 0) {
    return 0;
  }

  return clampScrollOffset(element.scrollTop, distance) / distance;
}

function synchronizeScroll(
  driverPane: ScrollPane,
  source: HTMLTextAreaElement,
  preview: HTMLElement,
  pendingOffsets: PendingScrollOffsets,
) {
  const driver = driverPane === "source" ? source : preview;
  const targetPane: ScrollPane = driverPane === "source" ? "preview" : "source";
  const target = targetPane === "source" ? source : preview;
  const targetDistance = scrollDistance(target);
  const targetOffset = clampScrollOffset(
    scrollProgress(driver) * targetDistance,
    targetDistance,
  );

  if (target.scrollTop === targetOffset) {
    return;
  }

  pendingOffsets[targetPane] = targetOffset;
  target.scrollTop = targetOffset;
}

function App() {
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [externalLinkError, setExternalLinkError] = useState<string | null>(
    null,
  );
  const [operationPending, setOperationPending] = useState(false);
  const [replacementPending, setReplacementPending] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [findOpen, setFindOpen] = useState(false);
  const [findValue, setFindValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchPosition, setMatchPosition] = useState<number | null>(null);
  const [selectionRequest, setSelectionRequest] = useState(0);
  const operationPendingRef = useRef(false);
  const documentRef = useRef<DocumentState | null>(document);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const focusEditorForSelectionRef = useRef(false);
  const mostRecentScrollDriverRef = useRef<ScrollPane | null>(null);
  const pendingScrollOffsetsRef = useRef<PendingScrollOffsets>({
    preview: null,
    source: null,
  });
  const shortcutActionsRef = useRef<
    Record<ShortcutAction, () => void | Promise<void>>
  >({
    new: () => undefined,
    open: () => undefined,
    save: () => undefined,
    saveAs: () => undefined,
  });
  const dirty = document !== null && document.content !== document.persistedContent;
  const dirtyRef = useRef(dirty);
  const matches =
    findOpen && document
      ? findLiteralMatches(document.content, findValue)
      : [];
  const activeMatchIndex =
    matchPosition === null
      ? -1
      : matches.findIndex((match) => match.start === matchPosition);
  const activeMatch =
    activeMatchIndex === -1 ? null : matches[activeMatchIndex];
  const activeMatchStart = activeMatch?.start ?? null;
  const activeMatchEnd = activeMatch?.end ?? null;
  const documentContent = document?.content ?? "";

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useLayoutEffect(() => {
    if (viewMode !== "split" || !mostRecentScrollDriverRef.current) {
      return;
    }

    const source = editorRef.current;
    const preview = previewRef.current;
    if (source && preview) {
      synchronizeScroll(
        mostRecentScrollDriverRef.current,
        source,
        preview,
        pendingScrollOffsetsRef.current,
      );
    }
  }, [documentContent, viewMode]);

  useEffect(() => {
    if (findOpen) {
      findInputRef.current?.focus();
    }
  }, [findOpen]);

  useEffect(() => {
    if (
      findOpen &&
      viewMode !== "preview" &&
      activeMatchStart !== null &&
      activeMatchEnd !== null
    ) {
      const editor = editorRef.current;
      if (editor) {
        const focusEditor = focusEditorForSelectionRef.current;
        focusEditorForSelectionRef.current = false;
        const focusedElement = globalThis.document.activeElement;
        if (focusEditor) {
          editor.focus();
        } else {
          editor.focus({ preventScroll: true });
        }
        editor.setSelectionRange(activeMatchStart, activeMatchEnd);
        if (
          !focusEditor &&
          focusedElement instanceof HTMLElement &&
          focusedElement !== editor
        ) {
          focusedElement.focus({ preventScroll: true });
        }
      }
    }
  }, [
    activeMatchEnd,
    activeMatchStart,
    documentContent,
    findOpen,
    selectionRequest,
    viewMode,
  ]);

  function requestActiveMatchSelection(focusEditor: boolean) {
    focusEditorForSelectionRef.current = focusEditor;
    setSelectionRequest((currentRequest) => currentRequest + 1);
  }

  function resetFindAndReplace() {
    setFindOpen(false);
    setFindValue("");
    setReplaceValue("");
    setMatchPosition(null);
  }

  function closeFindAndReplace() {
    const editor = editorRef.current;
    const caretPosition = editor?.selectionEnd ?? 0;
    resetFindAndReplace();
    if (editor) {
      editor.setSelectionRange(caretPosition, caretPosition);
      editor.focus();
    }
  }

  function handleViewModeChange(mode: ViewMode) {
    if (mode === "preview") {
      resetFindAndReplace();
    }
    if (mode !== viewMode) {
      if (mode === "split") {
        mostRecentScrollDriverRef.current =
          viewMode === "preview" ? "preview" : "source";
      }
      pendingScrollOffsetsRef.current.preview = null;
      pendingScrollOffsetsRef.current.source = null;
    }
    setViewMode(mode);
  }

  function handlePaneScroll(pane: ScrollPane) {
    if (viewMode !== "split") {
      return;
    }

    const source = editorRef.current;
    const preview = previewRef.current;
    if (!source || !preview) {
      return;
    }

    const element = pane === "source" ? source : preview;
    const expectedOffset = pendingScrollOffsetsRef.current[pane];
    pendingScrollOffsetsRef.current[pane] = null;
    if (expectedOffset !== null && element.scrollTop === expectedOffset) {
      return;
    }

    mostRecentScrollDriverRef.current = pane;
    synchronizeScroll(
      pane,
      source,
      preview,
      pendingScrollOffsetsRef.current,
    );
  }

  function handleOpenFind() {
    if (!document || replacementPending) {
      return;
    }

    if (viewMode === "preview") {
      setViewMode("edit");
    }
    if (findOpen) {
      findInputRef.current?.focus();
    } else {
      const editor = editorRef.current;
      if (editor) {
        editor.setSelectionRange(editor.selectionEnd, editor.selectionEnd);
      }
      setFindOpen(true);
    }
  }

  function handleFindValueChange(value: string) {
    setFindValue(value);
    const nextMatches = document
      ? findLiteralMatches(document.content, value)
      : [];
    setMatchPosition(nextMatches[0]?.start ?? (value ? 0 : null));

    if (nextMatches.length > 0) {
      requestActiveMatchSelection(false);
    } else {
      const editor = editorRef.current;
      if (editor) {
        editor.setSelectionRange(editor.selectionEnd, editor.selectionEnd);
      }
    }
  }

  function handleSourceChange(content: string, selectionPosition: number) {
    if (findOpen && findValue) {
      const nextMatches = findLiteralMatches(content, findValue);
      const priorPosition = matchPosition ?? selectionPosition;
      const matchAtSameRange = nextMatches.find(
        (match) => match.start === matchPosition,
      );
      const nextMatch =
        matchAtSameRange ?? findMatchAtOrAfter(nextMatches, priorPosition);
      setMatchPosition(nextMatch?.start ?? priorPosition);
    }

    setDocument((currentDocument) =>
      currentDocument ? { ...currentDocument, content } : currentDocument,
    );
  }

  function selectAdjacentMatch(offset: -1 | 1) {
    if (matches.length === 0) {
      return;
    }

    const nextIndex =
      activeMatchIndex === -1
        ? offset === 1
          ? 0
          : matches.length - 1
        : (activeMatchIndex + offset + matches.length) % matches.length;
    setMatchPosition(matches[nextIndex].start);
    requestActiveMatchSelection(true);
  }

  function handleReplace() {
    if (!document || !activeMatch || replacementPending) {
      return;
    }

    const content =
      document.content.slice(0, activeMatch.start) +
      replaceValue +
      document.content.slice(activeMatch.end);
    const insertedEnd = activeMatch.start + replaceValue.length;
    const nextMatches = findLiteralMatches(content, findValue);
    const nextMatch =
      nextMatches.find((match) => match.start >= insertedEnd) ??
      nextMatches.find((match) => match.start < activeMatch.start) ??
      null;

    setDocument((currentDocument) =>
      currentDocument ? { ...currentDocument, content } : currentDocument,
    );
    setMatchPosition(nextMatch?.start ?? insertedEnd);
    if (nextMatch) {
      requestActiveMatchSelection(true);
    }
  }

  function handleReplaceAll() {
    if (!document || matches.length === 0 || replacementPending) {
      return;
    }

    let sourcePosition = 0;
    let content = "";
    for (const match of matches) {
      content += document.content.slice(sourcePosition, match.start);
      content += replaceValue;
      sourcePosition = match.end;
    }
    content += document.content.slice(sourcePosition);

    const remainingMatches = findLiteralMatches(content, findValue);
    setDocument((currentDocument) =>
      currentDocument ? { ...currentDocument, content } : currentDocument,
    );
    setMatchPosition(remainingMatches[0]?.start ?? 0);
    if (remainingMatches.length > 0) {
      requestActiveMatchSelection(true);
    }
  }

  function beginOperation(protectEditor = false) {
    if (operationPendingRef.current) {
      return false;
    }

    operationPendingRef.current = true;
    setOperationPending(true);
    setReplacementPending(protectEditor);
    return true;
  }

  function finishOperation() {
    operationPendingRef.current = false;
    setOperationPending(false);
    setReplacementPending(false);
  }

  async function confirmDiscard(message: string) {
    if (!dirtyRef.current) {
      return true;
    }

    return confirm(message, discardDialogOptions);
  }

  async function handleNew() {
    if (!beginOperation(true)) {
      return;
    }

    try {
      if (
        !(await confirmDiscard(
          "Discard unsaved changes and create a new document?",
        ))
      ) {
        return;
      }

      const selectedPath = await save({
        title: "Create Markdown document",
        defaultPath: "untitled.md",
        filters: markdownFilter,
      });

      if (selectedPath === null) {
        return;
      }

      const name = await basename(selectedPath);
      await writeTextFile(selectedPath, "");
      setDocument({
        content: "",
        name,
        path: selectedPath,
        persistedContent: "",
      });
      resetFindAndReplace();
      setDocumentError(null);
    } catch (operationError) {
      setDocumentError(
        `Could not create the document: ${describeError(operationError)}`,
      );
    } finally {
      finishOperation();
    }
  }

  async function handleOpen() {
    if (!beginOperation(true)) {
      return;
    }

    try {
      if (
        !(await confirmDiscard(
          "Discard unsaved changes and open another document?",
        ))
      ) {
        return;
      }

      const selectedPath = await open({
        title: "Open Markdown document",
        directory: false,
        multiple: false,
        filters: markdownFilter,
      });

      if (selectedPath === null) {
        return;
      }

      const name = await basename(selectedPath);
      const content = await readTextFile(selectedPath);
      setDocument({
        content,
        name,
        path: selectedPath,
        persistedContent: content,
      });
      resetFindAndReplace();
      setDocumentError(null);
    } catch (operationError) {
      setDocumentError(
        `Could not open the document: ${describeError(operationError)}`,
      );
    } finally {
      finishOperation();
    }
  }

  async function handleSave() {
    if (!document || !dirty || !beginOperation()) {
      return;
    }

    const path = document.path;
    const content = document.content;

    try {
      await writeTextFile(path, content);
      setDocument((currentDocument) => {
        if (!currentDocument || currentDocument.path !== path) {
          return currentDocument;
        }

        return {
          ...currentDocument,
          persistedContent: content,
        };
      });
      setDocumentError(null);
    } catch (operationError) {
      setDocumentError(
        `Could not save the document: ${describeError(operationError)}`,
      );
    } finally {
      finishOperation();
    }
  }

  async function handleSaveAs() {
    if (!document || !beginOperation()) {
      return;
    }

    try {
      const selectedPath = await save({
        title: "Save Markdown document as",
        defaultPath: document.path,
        filters: markdownFilter,
      });

      if (selectedPath === null) {
        return;
      }

      const currentDocument = documentRef.current;
      if (!currentDocument) {
        return;
      }

      const sourcePath = currentDocument.path;
      const content = currentDocument.content;
      const name = await basename(selectedPath);
      await writeTextFile(selectedPath, content);
      setDocument((latestDocument) => {
        if (!latestDocument || latestDocument.path !== sourcePath) {
          return latestDocument;
        }

        return {
          ...latestDocument,
          name,
          path: selectedPath,
          persistedContent: content,
        };
      });
      setDocumentError(null);
    } catch (operationError) {
      setDocumentError(
        `Could not save the document as: ${describeError(operationError)}`,
      );
    } finally {
      finishOperation();
    }
  }

  useEffect(() => {
    shortcutActionsRef.current = {
      new: handleNew,
      open: handleOpen,
      save: handleSave,
      saveAs: handleSaveAs,
    };
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || (!event.ctrlKey && !event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      let action: ShortcutAction | null = null;
      if (!event.shiftKey && key === "n") {
        action = "new";
      } else if (!event.shiftKey && key === "o") {
        action = "open";
      } else if (key === "s") {
        action = event.shiftKey ? "saveAs" : "save";
      }

      if (!action) {
        return;
      }

      event.preventDefault();
      if (!event.repeat) {
        void shortcutActionsRef.current[action]();
      }
    }

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let disposed = false;
    let removeCloseListener: (() => void) | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (operationPendingRef.current) {
          event.preventDefault();
          return;
        }

        if (!dirtyRef.current) {
          return;
        }

        operationPendingRef.current = true;
        setOperationPending(true);

        try {
          const discard = await confirm(
            "Discard unsaved changes and close this document?",
            discardDialogOptions,
          );
          if (!discard) {
            event.preventDefault();
          }
        } catch (operationError) {
          event.preventDefault();
          setDocumentError(
            `Could not confirm closing the document: ${describeError(operationError)}`,
          );
        } finally {
          finishOperation();
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          removeCloseListener = unlisten;
        }
      })
      .catch((listenerError) => {
        if (!disposed) {
          setDocumentError(
            `Could not protect unsaved changes when closing: ${describeError(listenerError)}`,
          );
        }
      });

    return () => {
      disposed = true;
      removeCloseListener?.();
    };
  }, []);

  return (
    <div className="flex h-svh w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Markdora</h1>
          {document ? (
            <div className="mt-1 flex min-w-0 items-center gap-2 text-sm">
              <span
                className="truncate text-muted-foreground"
                title={document.path}
              >
                {document.name}
              </span>
              {dirty ? (
                <span className="shrink-0 font-medium text-foreground">
                  Unsaved
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          {document ? (
            <div aria-label="View mode" className="flex items-center gap-1" role="group">
              {(["edit", "split", "preview"] as const).map((mode) => (
                <Button
                  aria-pressed={viewMode === mode}
                  key={mode}
                  onClick={() => handleViewModeChange(mode)}
                  size="sm"
                  variant={viewMode === mode ? "default" : "outline"}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </Button>
              ))}
            </div>
          ) : null}
          {document ? (
            <Button
              disabled={replacementPending}
              onClick={handleOpenFind}
              size="sm"
            >
              Find
            </Button>
          ) : null}
          <nav
            aria-label="Document actions"
            className="flex items-center gap-2"
          >
            <Button disabled={operationPending} onClick={handleNew}>
              New
            </Button>
            <Button disabled={operationPending} onClick={handleOpen}>
              Open
            </Button>
            <Button
              disabled={!document || !dirty || operationPending}
              onClick={handleSave}
            >
              Save
            </Button>
            {document ? (
              <Button disabled={operationPending} onClick={handleSaveAs}>
                Save As
              </Button>
            ) : null}
          </nav>
        </div>
      </header>

      {document && findOpen ? (
        <section
          aria-label="Find and replace"
          className="flex shrink-0 flex-wrap items-end gap-2 border-b px-6 py-3"
        >
          <label className="grid min-w-40 flex-1 gap-1 text-sm font-medium sm:max-w-56">
            <span>Find</span>
            <Input
              disabled={replacementPending}
              onChange={(event) => handleFindValueChange(event.target.value)}
              ref={findInputRef}
              value={findValue}
            />
          </label>
          <label className="grid min-w-40 flex-1 gap-1 text-sm font-medium sm:max-w-56">
            <span>Replace with</span>
            <Input
              disabled={replacementPending}
              onChange={(event) => setReplaceValue(event.target.value)}
              value={replaceValue}
            />
          </label>
          <Button
            disabled={replacementPending || matches.length === 0}
            onClick={() => selectAdjacentMatch(-1)}
            size="sm"
          >
            Previous match
          </Button>
          <Button
            disabled={replacementPending || matches.length === 0}
            onClick={() => selectAdjacentMatch(1)}
            size="sm"
          >
            Next match
          </Button>
          <Button
            disabled={replacementPending || activeMatch === null}
            onClick={handleReplace}
            size="sm"
          >
            Replace
          </Button>
          <Button
            disabled={replacementPending || matches.length === 0}
            onClick={handleReplaceAll}
            size="sm"
          >
            Replace all
          </Button>
          <span
            aria-live="polite"
            className="min-w-20 text-center text-sm text-muted-foreground"
            role="status"
          >
            {!findValue
              ? "Enter text to find"
              : matches.length === 0
                ? "No matches"
                : `${activeMatchIndex + 1} of ${matches.length}`}
          </span>
          <Button onClick={closeFindAndReplace} size="sm">
            Close find and replace
          </Button>
        </section>
      ) : null}

      {documentError || externalLinkError ? (
        <div className="shrink-0 space-y-2 px-6 pt-4">
          {documentError ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {documentError}
            </div>
          ) : null}
          {externalLinkError ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {externalLinkError}
            </div>
          ) : null}
        </div>
      ) : null}

      <main
        className={
          document
            ? `grid min-h-0 min-w-0 flex-1 p-6 ${
                viewMode === "split" ? "grid-cols-2 gap-4" : "grid-cols-1"
              }`
            : "flex min-h-0 min-w-0 flex-1 items-center justify-center p-6"
        }
      >
        {document ? (
          <>
            {viewMode !== "preview" ? (
              <Textarea
                aria-label="Markdown source"
                className="h-full min-h-0 min-w-0 resize-none overflow-auto p-4 font-mono leading-6"
                disabled={replacementPending}
                onChange={(event) => {
                  handleSourceChange(
                    event.target.value,
                    event.target.selectionStart,
                  );
                }}
                onScroll={() => handlePaneScroll("source")}
                ref={editorRef}
                spellCheck={false}
                value={document.content}
              />
            ) : null}
            {viewMode !== "edit" ? (
              <MarkdownPreview
                content={document.content}
                documentPath={document.path}
                onExternalLinkError={(linkError) =>
                  setExternalLinkError(
                    `Could not open the external link: ${describeError(linkError)}`,
                  )
                }
                onExternalLinkSuccess={() => setExternalLinkError(null)}
                onScroll={() => handlePaneScroll("preview")}
                previewRef={previewRef}
              />
            ) : null}
          </>
        ) : (
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <CardTitle>
                <h2>No document open</h2>
              </CardTitle>
              <CardDescription>
                Open or create a Markdown document to begin.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </main>
    </div>
  );
}

export default App;
