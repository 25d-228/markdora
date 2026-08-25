import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  content: string;
  documentPath: string;
  onExternalLinkError: (error: unknown) => void;
  onExternalLinkSuccess: () => void;
};

type LocalImageProps = {
  alt?: string;
  documentPath: string;
  source?: string;
  title?: string;
};

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

function LocalImage({ alt = "", documentPath, source, title }: LocalImageProps) {
  const sourceIsEligible = source !== undefined && isPotentialRelativeImage(source);
  const [resolvedImage, setResolvedImage] = useState<{
    assetUrl: string | null;
    source: string | undefined;
    unavailable: boolean;
  }>(() => ({
    assetUrl: null,
    source,
    unavailable: !sourceIsEligible,
  }));
  const currentImage =
    resolvedImage.source === source
      ? resolvedImage
      : { assetUrl: null, source, unavailable: !sourceIsEligible };

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
            source,
            unavailable: false,
          });
        }
      })
      .catch(() => {
        if (!stale) {
          setResolvedImage({ assetUrl: null, source, unavailable: true });
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
        setResolvedImage({ assetUrl: null, source, unavailable: true })
      }
      src={currentImage.assetUrl}
      title={title}
    />
  );
}

function MarkdownPreview({
  content,
  documentPath,
  onExternalLinkError,
  onExternalLinkSuccess,
}: MarkdownPreviewProps) {
  const components: Components = {
    a: ({ children, href }) => {
      if (!href || !isApprovedExternalLink(href)) {
        return <span>{children}</span>;
      }

      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            void openUrl(href)
              .then(onExternalLinkSuccess)
              .catch(onExternalLinkError);
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ alt, src, title }) => (
      <LocalImage
        alt={alt}
        documentPath={documentPath}
        source={src}
        title={title}
      />
    ),
    input: ({ node, ...properties }) => {
      void node;
      return <input {...properties} disabled readOnly />;
    },
  };

  return (
    <section
      aria-label="Markdown preview"
      className="markdown-preview min-h-0 min-w-0 overflow-auto rounded-md border bg-background p-5"
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
    </section>
  );
}

export { MarkdownPreview };
