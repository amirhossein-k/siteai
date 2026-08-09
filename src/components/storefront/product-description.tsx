import type { RichDescriptionNode } from "@/types";
import { RICH_LIST_STYLE_TYPES } from "@/lib/product-description";
import { isAllowedImageSrc } from "@/lib/utils";

/**
 * Closed-set structured renderer for Product.descriptionRich (Slate JSON).
 *
 * SECURITY MODEL:
 *  - No dangerouslySetInnerHTML anywhere — every node maps to a fixed JSX
 *    element and all text is React-escaped.
 *  - Only allowlisted node types are rendered; anything unknown renders as
 *    inert plain text (never raw HTML).
 *  - Links render only when http/https; images only when isAllowedImageSrc.
 *  - This component is a SECOND gate behind the server-side allowlist
 *    validation (src/lib/product-description.ts) — defense in depth.
 *
 * Directive-free: importable from Server Components and client components.
 */

const ALIGN_CLASS: Record<string, string> = {
  right: "text-right",
  center: "text-center",
  left: "text-left",
  justify: "text-justify",
};

function Leaf({
  node,
  children,
}: {
  node: RichDescriptionNode;
  children: React.ReactNode;
}) {
  let el: React.ReactNode = children;
  if (node.bold) el = <strong>{el}</strong>;
  if (node.italic) el = <em>{el}</em>;
  if (node.underline) el = <u>{el}</u>;
  if (node.strikethrough) el = <s>{el}</s>;
  if (node.code) el = <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{el}</code>;
  if (node.highlight) el = <mark className="rounded bg-yellow-200/70 px-0.5 dark:bg-yellow-500/30">{el}</mark>;
  const style: React.CSSProperties = {};
  if (node.color) style.color = node.color;
  if (node.backgroundColor) style.backgroundColor = node.backgroundColor;
  if (node.color || node.backgroundColor) el = <span style={style}>{el}</span>;
  return <>{el}</>;
}

function RenderNode({ node }: { node: RichDescriptionNode }) {
  // Text leaf (or unknown shape → render as escaped text).
  if (typeof node.text === "string") {
    return <Leaf node={node}>{node.text}</Leaf>;
  }

  const alignClass = node.align ? ALIGN_CLASS[node.align] : undefined;
  const children = Array.isArray(node.children)
    ? node.children.map((child, i) => <RenderNode key={i} node={child} />)
    : null;

  switch (node.type) {
    case "p":
      return (
        <p className={alignClass} dir="auto">
          {children}
        </p>
      );
    case "h1":
    case "h2":
    case "h3": {
      const Tag = node.type as "h1" | "h2" | "h3";
      return (
        <Tag className={alignClass} dir="auto">
          {children}
        </Tag>
      );
    }
    case "ul":
      return <ul className={alignClass}>{children}</ul>;
    case "ol":
      return <ol className={alignClass}>{children}</ol>;
    case "li":
      // Classic nested model (ul/ol > li).
      return <li dir="auto">{children}</li>;
    case "blockquote":
      return (
        <blockquote
          className={`rounded-r-md border-r-4 border-primary/30 bg-muted/40 px-3 py-1.5 ${alignClass ?? ""}`}
          dir="auto"
        >
          {children}
        </blockquote>
      );
    case "hr":
      return <hr className="my-3 border-border" />;
    case "a": {
      const url = node.url;
      const safe =
        typeof url === "string" && /^https?:\/\/.+/.test(url) ? url : null;
      if (!safe) {
        // Unsafe link → render its content as inert text, never an anchor.
        return <span>{children}</span>;
      }
      return (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer nofollow"
          dir="auto"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {children}
        </a>
      );
    }
    case "img": {
      const src = node.url;
      if (typeof src !== "string" || !isAllowedImageSrc(src)) {
        return null; // unsafe image → do not render
      }
      // eslint-disable-next-line @next/next/no-img-element -- dynamic rich-content URLs are not next/image remotePattern candidates; guarded by isAllowedImageSrc
      return <img src={src} alt="" loading="lazy" className="my-2 max-w-full rounded-md" />;
    }
    case "table":
      return (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {children}
          </table>
        </div>
      );
    case "tr":
      return <tr>{children}</tr>;
    case "td":
    case "th": {
      const Tag = node.type as "td" | "th";
      return (
        <Tag className="border border-border px-2 py-1 text-start">
          {children}
        </Tag>
      );
    }
    default:
      // Unknown node type → render children as inert content (no raw HTML).
      return <span>{children}</span>;
  }
}

/**
 * Plate v53 ListPlugin uses a FLAT list model: list items are ordinary block
 * nodes (p, h1...) carrying `listStyleType` + `indent` — there are no ul/ol/li
 * wrapper nodes. This groups consecutive same-style, same-depth siblings into
 * a real <ul>/<ol> for semantic + SEO-friendly output (nested depths render
 * as indented nested lists).
 */
type ListRun = {
  type: "ul" | "ol";
  start?: number;
  indent: number;
  items: RichDescriptionNode[];
};

function groupListRun(
  nodes: RichDescriptionNode[]
): Array<ListRun | RichDescriptionNode> {
  const out: Array<ListRun | RichDescriptionNode> = [];
  let run: ListRun | null = null;

  const isListItem = (n: RichDescriptionNode): boolean =>
    !!n.listStyleType && !!(RICH_LIST_STYLE_TYPES as readonly string[]).includes(n.listStyleType);
  const styleOf = (n: RichDescriptionNode): "ul" | "ol" =>
    n.listStyleType === "ol" ||
    ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"].includes(n.listStyleType || "")
      ? "ol"
      : "ul";

  for (const node of nodes) {
    if (isListItem(node)) {
      const style = styleOf(node);
      const indent = typeof node.indent === "number" ? node.indent : 0;
      if (
        !run ||
        run.type !== style ||
        run.indent !== indent ||
        // a fresh run never carries start, so a restart value forces a new run
        (typeof node.listStart === "number" && run.items.length > 0)
      ) {
        run = { type: style, indent, start: typeof node.listStart === "number" ? node.listStart : undefined, items: [] };
        out.push(run);
      }
      run.items.push(node);
    } else {
      run = null;
      out.push(node);
    }
  }
  return out;
}

export function ProductDescription({
  value,
}: {
  value: RichDescriptionNode[];
}) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div className="space-y-2 text-sm leading-7 text-muted-foreground [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-foreground [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5">
      {groupListRun(value).map((item, i) => {
        if ("items" in item && "type" in item) {
          const ListTag = item.type;
          return (
            <ListTag
              key={i}
              start={item.start}
              className={"pr-5 " + (item.type === "ul" ? "list-disc" : "list-decimal")}
              style={item.indent > 0 ? { marginInlineStart: `${item.indent * 1.25}rem` } : undefined}
            >
              {item.items.map((n, j) => (
                <li key={j} dir="auto">
                  <RenderNode node={{ ...n, listStyleType: undefined, indent: undefined, listStart: undefined }} />
                </li>
              ))}
            </ListTag>
          );
        }
        return <RenderNode key={i} node={item} />;
      })}
    </div>
  );
}
