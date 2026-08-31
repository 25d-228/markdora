import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Element, ElementContent, Root, Text } from "hast";
import type {
  Definition,
  Link,
  LinkReference,
  Nodes as MarkdownNode,
  Parents as MarkdownParent,
  Root as MarkdownRoot,
} from "mdast";
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  activeMatchStart: number | null;
  content: string;
  documentPath: string;
  findMatches: PreviewMatch[];
  findQuery: string;
  onActiveMatchReveal: (scrollTop: number) => void;
  onExternalLinkError: (error: unknown) => void;
  onExternalLinkSuccess: () => void;
  onScroll: () => void;
  previewRef: RefObject<HTMLElement | null>;
};

type PreviewMatch = {
  end: number;
  start: number;
};

type SourceRange = {
  end: number;
  start: number;
};

type LocalImageProps = {
  alt?: string;
  source?: string;
  title?: string;
};

type PreviewContextValue = Pick<
  MarkdownPreviewProps,
  "documentPath" | "onExternalLinkError" | "onExternalLinkSuccess"
>;

const PreviewContext = createContext<PreviewContextValue | null>(null);

const supportedImageExtension = /\.(?:png|jpe?g|gif|webp|avif)$/i;

function resolveReferenceLinks() {
  return function transform(tree: MarkdownRoot) {
    const definitions = new Map<string, Definition>();

    function collectDefinitions(node: MarkdownNode) {
      if (node.type === "definition" && !definitions.has(node.identifier)) {
        definitions.set(node.identifier, node);
      }
      if ("children" in node) {
        node.children.forEach(collectDefinitions);
      }
    }

    function resolveLinks(node: MarkdownNode) {
      if (node.type === "linkReference") {
        const definition = definitions.get(node.identifier);
        if (definition) {
          const reference = node as LinkReference;
          const link = node as unknown as Link;
          link.type = "link";
          link.url = definition.url;
          link.title = definition.title;
          delete (reference as Partial<LinkReference>).identifier;
          delete (reference as Partial<LinkReference>).label;
          delete (reference as Partial<LinkReference>).referenceType;
        }
      }
      if ("children" in node) {
        (node as MarkdownParent).children.forEach(resolveLinks);
      }
    }

    collectDefinitions(tree);
    resolveLinks(tree);
  };
}

function getSourceRange(node: ElementContent | Root): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === "number" && typeof end === "number"
    ? { end, start }
    : null;
}

function getCodeContentRange(
  node: Element,
  parentTag: string | null,
  content: string,
): SourceRange | null {
  const range = getSourceRange(node);
  if (!range) {
    return null;
  }

  const source = content.slice(range.start, range.end);
  if (parentTag === "pre") {
    const firstLineEnd = source.indexOf("\n");
    const closingLineStart = source.lastIndexOf("\n") + 1;
    const openingFence = source
      .slice(0, firstLineEnd === -1 ? source.length : firstLineEnd)
      .trimStart()
      .match(/^(`{3,}|~{3,})/);
    if (
      firstLineEnd !== -1 &&
      closingLineStart > firstLineEnd &&
      openingFence &&
      source
        .slice(closingLineStart)
        .trimStart()
        .startsWith(openingFence[1][0].repeat(openingFence[1].length))
    ) {
      return {
        start: range.start + firstLineEnd + 1,
        end: range.start + closingLineStart,
      };
    }
    return range;
  }

  const openingDelimiter = source.match(/^(`+)/)?.[1];
  if (!openingDelimiter || !source.endsWith(openingDelimiter)) {
    return range;
  }

  let start = range.start + openingDelimiter.length;
  let end = range.end - openingDelimiter.length;
  const code = content.slice(start, end);
  if (
    code.length > 2 &&
    code.startsWith(" ") &&
    code.endsWith(" ") &&
    code.trim().length > 0
  ) {
    start += 1;
    end -= 1;
  }
  return { end, start };
}

function mapDisplayedTextToSource(
  value: string,
  content: string,
  range: SourceRange,
) {
  const offsets: Array<number | null> = [];
  let sourcePosition = range.start;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const offset = content.indexOf(character, sourcePosition);
    if (offset === -1 || offset >= range.end) {
      offsets.push(null);
    } else {
      offsets.push(offset);
      sourcePosition = offset + character.length;
    }
  }

  return offsets;
}

function highlightTextNode(
  node: Text,
  range: SourceRange,
  content: string,
  matches: PreviewMatch[],
  activeMatchStart: number | null,
): ElementContent[] {
  if (matches.length === 0 || node.value.length === 0) {
    return [node];
  }

  const query = content.slice(matches[0].start, matches[0].end);
  if (!query) {
    return [node];
  }

  const normalizedValue = node.value.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const sourceOffsets = mapDisplayedTextToSource(node.value, content, range);
  const matchesByStart = new Map(matches.map((match) => [match.start, match]));
  const visibleMatches: Array<{
    end: number;
    sourceStart: number;
    start: number;
  }> = [];
  let position = 0;

  while (position <= normalizedValue.length - normalizedQuery.length) {
    const visibleStart = normalizedValue.indexOf(normalizedQuery, position);
    if (visibleStart === -1) {
      break;
    }

    const sourceStart = sourceOffsets[visibleStart];
    const sourceEnd = sourceOffsets[visibleStart + normalizedQuery.length - 1];
    const sourceMatch =
      sourceStart === null ? undefined : matchesByStart.get(sourceStart);
    const contiguous =
      sourceStart !== null &&
      sourceOffsets
        .slice(visibleStart, visibleStart + normalizedQuery.length)
        .every((offset, index) => offset === sourceStart + index);
    if (
      sourceMatch &&
      sourceStart !== null &&
      sourceEnd !== null &&
      sourceMatch.end === sourceEnd + 1 &&
      contiguous
    ) {
      visibleMatches.push({
        end: visibleStart + normalizedQuery.length,
        sourceStart,
        start: visibleStart,
      });
    }
    position = visibleStart + normalizedQuery.length;
  }

  if (visibleMatches.length === 0) {
    return [node];
  }

  const children: ElementContent[] = [];
  let textPosition = 0;
  for (const visibleMatch of visibleMatches) {
    if (visibleMatch.start > textPosition) {
      children.push({
        type: "text",
        value: node.value.slice(textPosition, visibleMatch.start),
      });
    }

    const active = visibleMatch.sourceStart === activeMatchStart;
    children.push({
      type: "element",
      tagName: "mark",
      properties: {
        ariaCurrent: active ? "true" : undefined,
        className: active
          ? ["preview-find-match", "preview-find-match-active"]
          : ["preview-find-match"],
        dataSourceStart: String(visibleMatch.sourceStart),
      },
      children: [
        {
          type: "text",
          value: node.value.slice(visibleMatch.start, visibleMatch.end),
        },
      ],
    });
    textPosition = visibleMatch.end;
  }

  if (textPosition < node.value.length) {
    children.push({ type: "text", value: node.value.slice(textPosition) });
  }
  return children;
}

function createPreviewHighlightPlugin(
  content: string,
  matches: PreviewMatch[],
  activeMatchStart: number | null,
) {
  return function previewHighlightPlugin() {
    return function transform(tree: Root) {
      function visit(
        node: Root | Element,
        inheritedRange: SourceRange | null,
        parentTag: string | null,
      ) {
        const nodeRange = getSourceRange(node) ?? inheritedRange;
        const childRange =
          node.type === "element" && node.tagName === "code"
            ? getCodeContentRange(node, parentTag, content) ?? nodeRange
            : nodeRange;

        for (let index = 0; index < node.children.length; index += 1) {
          const child = node.children[index];
          if (child.type === "text") {
            const range =
              node.type === "element" && node.tagName === "code"
                ? childRange
                : getSourceRange(child) ?? childRange;
            if (range) {
              const replacements = highlightTextNode(
                child,
                range,
                content,
                matches,
                activeMatchStart,
              );
              node.children.splice(index, 1, ...replacements);
              index += replacements.length - 1;
            }
          } else if (child.type === "element") {
            visit(child, childRange, node.type === "element" ? node.tagName : null);
          }
        }
      }

      visit(tree, getSourceRange(tree), null);
    };
  };
}

function isApprovedExternalLink(destination: string) {
  if (!/^(?:https?:\/\/|mailto:)/i.test(destination)) {
    return false;
  }

  try {
    const protocol = new URL(destination).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function isPotentialRelativeImage(source: string) {
  if (
    !source ||
    source.startsWith("/") ||
    source.startsWith("\\") ||
    source.includes(":") ||
    source.includes("\\") ||
    !supportedImageExtension.test(source)
  ) {
    return false;
  }

  return !source.split("/").includes("..");
}

function usePreviewContext() {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error("Markdown preview components require preview context");
  }

  return context;
}

function ExternalLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  const { onExternalLinkError, onExternalLinkSuccess } = usePreviewContext();

  function activate() {
    void openUrl(href).then(onExternalLinkSuccess).catch(onExternalLinkError);
  }

  function preventBrowserDefault(event: MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
  }

  return (
    <span
      onAuxClick={preventBrowserDefault}
      onClick={(event) => {
        event.preventDefault();
        if (
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          activate();
        }
      }}
      onContextMenu={preventBrowserDefault}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Enter" && !event.repeat) {
          event.preventDefault();
          activate();
        }
      }}
      role="link"
      tabIndex={0}
    >
      {children}
    </span>
  );
}

function LocalImage({ alt = "", source, title }: LocalImageProps) {
  const { documentPath } = usePreviewContext();
  const sourceIsEligible = source !== undefined && isPotentialRelativeImage(source);
  const [resolvedImage, setResolvedImage] = useState<{
    assetUrl: string | null;
    documentPath: string;
    source: string | undefined;
    unavailable: boolean;
  }>(() => ({
    assetUrl: null,
    documentPath,
    source,
    unavailable: !sourceIsEligible,
  }));
  const currentImage =
    resolvedImage.documentPath === documentPath &&
    resolvedImage.source === source
      ? resolvedImage
      : { assetUrl: null, documentPath, source, unavailable: !sourceIsEligible };

  useEffect(() => {
    let stale = false;

    if (!source || !isPotentialRelativeImage(source)) {
      return;
    }

    void invoke<string>("authorize_preview_image", {
      documentPath,
      imageSource: source,
    })
      .then((authorizedPath) => {
        if (!stale) {
          setResolvedImage({
            assetUrl: convertFileSrc(authorizedPath),
            documentPath,
            source,
            unavailable: false,
          });
        }
      })
      .catch(() => {
        if (!stale) {
          setResolvedImage({
            assetUrl: null,
            documentPath,
            source,
            unavailable: true,
          });
        }
      });

    return () => {
      stale = true;
    };
  }, [documentPath, source]);

  if (!currentImage.assetUrl || currentImage.unavailable) {
    return (
      <span
        aria-label={alt || "Unavailable image"}
        className="markdown-image-placeholder"
        role="img"
        title={title}
      >
        {alt || "Image unavailable"}
      </span>
    );
  }

  return (
    <img
      alt={alt}
      onError={() =>
        setResolvedImage({
          assetUrl: null,
          documentPath,
          source,
          unavailable: true,
        })
      }
      src={currentImage.assetUrl}
      title={title}
    />
  );
}

const components: Components = {
  a: ({ children, href }) =>
    href && isApprovedExternalLink(href) ? (
      <ExternalLink href={href}>{children}</ExternalLink>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt, src, title }) => (
    <LocalImage alt={alt} source={src} title={title} />
  ),
  input: ({ node, ...properties }) => {
    void node;
    return <input {...properties} disabled readOnly />;
  },
};

function MarkdownPreview({
  activeMatchStart,
  content,
  documentPath,
  findMatches,
  findQuery,
  onActiveMatchReveal,
  onExternalLinkError,
  onExternalLinkSuccess,
  onScroll,
  previewRef,
}: MarkdownPreviewProps) {
  useLayoutEffect(() => {
    if (activeMatchStart === null) {
      return;
    }

    const preview = previewRef.current;
    const activeMatch = preview?.querySelector(
      'mark.preview-find-match[aria-current="true"]',
    );
    if (preview && activeMatch instanceof HTMLElement) {
      activeMatch.scrollIntoView?.({ block: "nearest" });
      onActiveMatchReveal(preview.scrollTop);
    }
  }, [activeMatchStart, content, findQuery, onActiveMatchReveal, previewRef]);

  return (
    <section
      aria-label="Markdown preview"
      className="markdown-preview min-h-0 min-w-0 overflow-auto rounded-md border bg-background p-5"
      onScroll={onScroll}
      ref={previewRef}
    >
      <PreviewContext.Provider
        value={{ documentPath, onExternalLinkError, onExternalLinkSuccess }}
      >
        <Markdown
          components={components}
          rehypePlugins={[
            createPreviewHighlightPlugin(
              content,
              findMatches,
              activeMatchStart,
            ),
          ]}
          remarkPlugins={[remarkGfm, resolveReferenceLinks]}
          skipHtml
          urlTransform={(url, key) => {
            if (key === "href") {
              return isApprovedExternalLink(url) ? url : "";
            }
            if (key === "src") {
              return isPotentialRelativeImage(url) ? url : "";
            }
            return "";
          }}
        >
          {content}
        </Markdown>
      </PreviewContext.Provider>
    </section>
  );
}

export { MarkdownPreview };
