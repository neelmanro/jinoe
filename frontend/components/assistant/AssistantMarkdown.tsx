"use client";

import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/** Same streaming-safe LaTeX normalization as `neel.tsx` MarkdownRenderer. */
function preprocessLatex(text: string) {
  let processed = text;
  processed = processed.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
  processed = processed.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
  const blockCount = (processed.match(/\$\$/g) || []).length;
  if (blockCount % 2 !== 0) {
    processed += "\n$$";
  }
  return processed;
}

export type AssistantMarkdownProps = {
  content: string;
};

const components: Components = {
  h1: ({ children, ...rest }) => (
    <h1
      className="mb-2 mt-6 text-[1.35rem] font-extrabold leading-tight tracking-[-0.03em] text-[var(--ink-strong)] first:mt-0 md:text-[1.6rem]"
      {...rest}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2
      className="mb-2 mt-5 text-[1.2rem] font-extrabold leading-snug tracking-[-0.025em] text-[var(--ink-strong)] first:mt-0 md:text-[1.35rem]"
      {...rest}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3
      className="mb-1.5 mt-4 text-[1.05rem] font-extrabold leading-snug tracking-[-0.02em] text-[var(--ink-strong)] first:mt-0 md:text-[1.15rem]"
      {...rest}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...rest }) => (
    <h4 className="mb-1.5 mt-3 text-[15px] font-bold tracking-[-0.015em] text-[var(--ink-strong)] first:mt-0" {...rest}>
      {children}
    </h4>
  ),
  h5: ({ children, ...rest }) => (
    <h5 className="mb-1 mt-3 text-[13.5px] font-bold text-[var(--ink-2)] first:mt-0" {...rest}>
      {children}
    </h5>
  ),
  h6: ({ children, ...rest }) => (
    <h6 className="mb-1 mt-2 text-[12.5px] font-bold uppercase tracking-[0.06em] text-[var(--ink-muted)] first:mt-0" {...rest}>
      {children}
    </h6>
  ),
  p: ({ children, ...rest }) => (
    <p className="my-2.5 text-[13px] font-semibold leading-relaxed text-[var(--ink-2)] first:mt-0 last:mb-0" {...rest}>
      {children}
    </p>
  ),
  a: ({ href, children, ...rest }) => {
    const safe = href && (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:"));
    return (
      <a
        href={href}
        className="font-semibold text-[var(--ink-strong)] underline decoration-2 underline-offset-2 decoration-[var(--line-strong)] hover:decoration-[var(--ink-strong)]"
        target={safe && !href.startsWith("mailto:") ? "_blank" : undefined}
        rel={safe && !href.startsWith("mailto:") ? "noopener noreferrer" : undefined}
        {...rest}
      >
        {children}
      </a>
    );
  },
  ul: (props) => <ul className="my-2.5 ml-4 list-disc space-y-1.5 text-[13px] font-semibold text-[var(--ink-2)] first:mt-0" {...props} />,
  ol: (props) => <ol className="my-2.5 ml-4 list-decimal space-y-1.5 text-[13px] font-semibold text-[var(--ink-2)] first:mt-0" {...props} />,
  li: (props) => <li className="leading-relaxed [&>p]:my-1" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="my-3 border-l-[3px] border-[var(--ink-strong)] bg-[var(--surface-muted)] py-2 pl-3 pr-3 text-[13px] font-semibold text-[var(--ink-2)] first:mt-0"
      {...props}
    />
  ),
  hr: (props) => <hr className="my-5 border-0 border-t border-[var(--line-strong)]" {...props} />,
  table: (props) => (
    <div className="my-3 w-full overflow-x-auto first:mt-0">
      <table className="w-full min-w-[280px] border-collapse border border-[var(--line-strong)] text-left" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-[var(--surface-muted)]" {...props} />,
  th: (props) => (
    <th
      className="border-b border-[var(--ink-strong)] px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-[0.05em] text-[var(--ink-strong)]"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border-b border-[var(--line)] px-3 py-2 align-top text-[12.5px] font-semibold text-[var(--ink-2)]" {...props} />
  ),
  tr: (props) => <tr className="even:bg-[var(--surface-muted)]/60" {...props} />,
  pre: (props) => (
    <pre
      className="my-3 overflow-x-auto rounded-[8px] border border-[var(--line-strong)] bg-[var(--surface-muted)] p-3 font-mono text-[12px] leading-relaxed text-[var(--ink-2)] first:mt-0"
      {...props}
    />
  ),
  code: (props) => {
    const { className, children, inline } = props as {
      className?: string;
      children?: ReactNode;
      inline?: boolean;
    };
    if (inline === true) {
      return (
        <code className="rounded border border-[var(--line)] bg-[var(--surface-soft)] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-[var(--ink-strong)]">
          {children}
        </code>
      );
    }
    const raw = String(children ?? "");
    return <code className={`${className ?? ""} font-mono text-[12px]`}>{raw}</code>;
  },
  strong: (props) => <strong className="font-extrabold text-[var(--ink-strong)]" {...props} />,
  em: (props) => <em className="italic text-[var(--ink-2)]" {...props} />,
};

export function AssistantMarkdown({ content }: AssistantMarkdownProps) {
  const processed = useMemo(() => preprocessLatex(content), [content]);

  return (
    <div className="assistant-markdown w-full max-w-none text-left [&_.katex]:text-[1em] [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&>:first-child]:mt-0">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
