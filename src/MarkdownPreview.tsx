import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  content: string;
  documentPath: string;
  onExternalLinkError: (error: unknown) => void;
  onExternalLinkSuccess: () => void;
  onScroll: () => void;
  previewRef: Ref<HTMLElement>;
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
  content,
  documentPath,
  onExternalLinkError,
  onExternalLinkSuccess,
  onScroll,
  previewRef,
}: MarkdownPreviewProps) {
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
          remarkPlugins={[remarkGfm]}
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
