import { basename } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type DocumentState = {
  content: string;
  name: string;
  path: string;
  persistedContent: string;
};

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

function App() {
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [replacementPending, setReplacementPending] = useState(false);
  const operationPendingRef = useRef(false);
  const dirty = document !== null && document.content !== document.persistedContent;
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

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
      setError(null);
    } catch (operationError) {
      setError(
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
      setError(null);
    } catch (operationError) {
      setError(
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
      setError(null);
    } catch (operationError) {
      setError(
        `Could not save the document: ${describeError(operationError)}`,
      );
    } finally {
      finishOperation();
    }
  }

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
          setError(
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
          setError(
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
        <nav
          aria-label="Document actions"
          className="flex shrink-0 items-center gap-2"
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
        </nav>
      </header>

      {error ? (
        <div className="shrink-0 px-6 pt-4">
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        </div>
      ) : null}

      <main
        className={
          document
            ? "flex min-h-0 min-w-0 flex-1 p-6"
            : "flex min-h-0 min-w-0 flex-1 items-center justify-center p-6"
        }
      >
        {document ? (
          <Textarea
            aria-label="Markdown source"
            className="h-full min-h-0 min-w-0 resize-none p-4 font-mono leading-6"
            disabled={replacementPending}
            onChange={(event) => {
              const content = event.target.value;
              setDocument((currentDocument) =>
                currentDocument
                  ? {
                      ...currentDocument,
                      content,
                    }
                  : currentDocument,
              );
            }}
            spellCheck={false}
            value={document.content}
          />
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
