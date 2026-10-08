import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

import { slugifyHeading } from "@/lib/manual";

function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (children && typeof children === "object" && "props" in children) return textOf((children as { props: { children?: ReactNode } }).props.children);
  return "";
}

/**
 * Renders a piece of the manual. Raw HTML in the Markdown is never rendered
 * (react-markdown's default), links to other sites open in a new tab, and
 * wide tables scroll sideways instead of breaking the page on a phone.
 */
export default function ManualMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h3: ({ children: content }) => <h3 id={slugifyHeading(textOf(content))}>{content}</h3>,
        a: ({ href, children: content }) => {
          const external = Boolean(href && /^https?:\/\//i.test(href));
          return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{content}</a>;
        },
        table: ({ children: content }) => <div className="manual-table-wrap"><table>{content}</table></div>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
