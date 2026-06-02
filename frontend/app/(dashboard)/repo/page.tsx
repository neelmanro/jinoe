"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, getApiBase, getStoredToken } from "@/components/auth/auth-context";
import { showDashboardToast } from "@/components/DashboardToastHost";
import { pageBg } from "@/components/auth/JinoeAuthChrome";
import { useProject } from "@/components/sidebar/project-context";
import { SelectProjectFirst } from "@/components/ui/SelectProjectFirst";

// ─── Types ───────────────────────────────────────────────────────────────────

type RepoEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  size: number | null;
};

type RepoFile = {
  path: string;
  name: string;
  content: string;
  size: number;
};

type TreeNode = RepoEntry & {
  children: TreeNode[];
};

const VIRTUAL_TREE_PROJECT = "__jinoe_display__/project";

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(size: number | null | undefined) {
  if (size == null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Matches backend `_slugify_project_name` for download filenames. */
function downloadZipStem(name: string) {
  const raw = name.trim().toLowerCase();
  const ascii = raw.normalize("NFD").replace(/\p{M}/gu, "");
  const slug = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || "project").slice(0, 80);
}

function buildTree(entries: RepoEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const nodesByPath = new Map<string, TreeNode>();
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let currentPath = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      const existing = nodesByPath.get(currentPath);
      const node =
        existing ??
        ({
          path: currentPath,
          name: part,
          type: isLeaf ? entry.type : "directory",
          size: isLeaf ? entry.size : null,
          children: [],
        } satisfies TreeNode);
      if (!existing) {
        nodesByPath.set(currentPath, node);
        if (parentPath) nodesByPath.get(parentPath)?.children.push(node);
        else roots.push(node);
      }
      if (isLeaf) {
        node.type = entry.type;
        node.size = entry.size;
      }
    }
  }
  for (const node of nodesByPath.values()) node.children.sort(sortNodes);
  return roots.sort(sortNodes);
}

function sortNodes(a: TreeNode, b: TreeNode) {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function collectDirectoryPaths(nodes: TreeNode[], into: Set<string>) {
  for (const n of nodes) {
    if (n.type === "directory") {
      into.add(n.path);
      collectDirectoryPaths(n.children, into);
    }
  }
}

function defaultCollapsedDirectoryPaths(nodes: TreeNode[]): Set<string> {
  const next = new Set<string>();
  collectDirectoryPaths(nodes, next);
  return next;
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IcoChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 180ms cubic-bezier(0.4,0,0.2,1)",
        color: "var(--ink-4)",
        flexShrink: 0,
      }}
    >
      <path d="M2.5 1.5L6 4.5L2.5 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IcoFolder({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      {open ? (
        <>
          <path
            d="M1.5 5A1.5 1.5 0 013 3.5H6.5L8 5H13A1.5 1.5 0 0114.5 6.5V12A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12V5z"
            fill="var(--accent)"
          />
          <path d="M1.5 7.5h13" stroke="rgba(0,0,0,0.1)" strokeWidth="0.8" />
        </>
      ) : (
        <path
          d="M1.5 5A1.5 1.5 0 013 3.5H6.5L8 5H13A1.5 1.5 0 0114.5 6.5V12A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12V5z"
          stroke="var(--ink-4)" strokeWidth="1.1" fill="transparent"
        />
      )}
    </svg>
  );
}

function IcoProject() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="var(--ink-3)" strokeWidth="1.2" />
      <path d="M4.5 5.5h7M4.5 8h4.5" stroke="var(--ink-3)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IcoSearch() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7.5" />
      <path d="M21 21l-3.7-3.7" />
    </svg>
  );
}

function IcoCopy({ done }: { done: boolean }) {
  return done ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function IcoDownload() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v13M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function IcoRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ animation: spinning ? "repo-spin 0.75s linear infinite" : undefined }}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

function IcoArchive({ spinning }: { spinning: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ animation: spinning ? "repo-spin 0.75s linear infinite" : undefined }}>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function IcoFile() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M13 2v7h7M8 13h8M8 17h5" />
    </svg>
  );
}

function IcoFileRow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ flexShrink: 0, color: "var(--ink-4)" }}>
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M13 2v7h7M8 13h8M8 17h5" />
    </svg>
  );
}

// ─── File Tree ────────────────────────────────────────────────────────────────

function TreeRows({
  nodes, selectedPath, onSelectFile, expandedPaths,
  onToggleDirectory, getNodeTitle, depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  getNodeTitle: (node: TreeNode) => string;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isSelected = node.type === "file" && selectedPath === node.path;
        const isDir = node.type === "directory";
        const isExpanded = isDir && expandedPaths.has(node.path);
        const isVirtual = node.path === VIRTUAL_TREE_PROJECT;

        return (
          <div key={node.path}>
            <button
              type="button"
              role="treeitem"
              aria-expanded={isDir ? isExpanded : undefined}
              aria-selected={isSelected}
              onClick={() => { if (isDir) onToggleDirectory(node.path); else onSelectFile(node.path); }}
              title={getNodeTitle(node)}
              className="repo-node"
              style={{
                display: "flex", alignItems: "center", width: "100%", minWidth: 0,
                gap: 5, paddingRight: 10, textAlign: "left",
                paddingLeft: isVirtual ? 8 : 8 + depth * 16,
                height: isVirtual ? 36 : 27,
                border: "none", cursor: "pointer", position: "relative",
                borderRadius: 5,
                background: isSelected
                  ? "color-mix(in srgb, var(--accent) 14%, white)"
                  : "transparent",
              }}
            >
              {/* Selected left accent bar */}
              {isSelected && (
                <span style={{
                  position: "absolute", left: 0, top: "16%", height: "68%",
                  width: 2.5, borderRadius: "0 2px 2px 0",
                  background: "var(--accent)",
                }} />
              )}

              {/* Chevron slot */}
              <span style={{
                width: 14, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {isDir && <IcoChevron open={isExpanded} />}
              </span>

              {/* File/folder icon */}
              <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                {isVirtual ? <IcoProject /> : isDir ? <IcoFolder open={isExpanded} /> : <IcoFileRow />}
              </span>

              {/* Name */}
              <span style={{
                flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontSize: isVirtual ? 12.5 : 12,
                fontWeight: isVirtual ? 700 : isDir ? 600 : isSelected ? 600 : 500,
                letterSpacing: isVirtual ? "-0.018em" : isDir ? "-0.01em" : "-0.005em",
                color: isSelected
                  ? "var(--ink-strong)"
                  : isVirtual ? "var(--ink-strong)"
                  : isDir ? "var(--ink-2)"
                  : "var(--ink-3)",
              }}>
                {node.name}
              </span>

              {/* Size for files */}
              {node.type === "file" && node.size != null && (
                <span style={{
                  fontSize: 9.5, color: "var(--ink-5)", fontWeight: 500, flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {formatBytes(node.size)}
                </span>
              )}
            </button>

            {/* Children group */}
            {isDir && isExpanded && node.children.length > 0 && (
              <div role="group" style={{ position: "relative" }}>
                {!isVirtual && (
                  <span style={{
                    position: "absolute",
                    left: 15 + depth * 16,
                    top: 4, bottom: 4, width: 1,
                    background: "var(--line)",
                    borderRadius: 1,
                    pointerEvents: "none",
                  }} />
                )}
                <TreeRows
                  nodes={node.children}
                  selectedPath={selectedPath}
                  onSelectFile={onSelectFile}
                  expandedPaths={expandedPaths}
                  onToggleDirectory={onToggleDirectory}
                  getNodeTitle={getNodeTitle}
                  depth={depth + 1}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function TreeSkeleton() {
  const widths = [68, 45, 82, 55, 40, 70, 58, 48, 75];
  return (
    <div style={{ padding: "10px 10px" }}>
      {widths.map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, paddingLeft: i > 2 ? 24 : i > 0 ? 12 : 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--line)", flexShrink: 0 }} />
          <span style={{
            height: 8, borderRadius: 4, width: `${w}%`, display: "block",
            backgroundImage: "linear-gradient(90deg, var(--line) 0%, var(--bg-sunken) 40%, var(--line) 80%)",
            backgroundSize: "300% 100%",
            animation: `repo-shimmer ${1.3 + i * 0.08}s ease infinite`,
          }} />
        </div>
      ))}
    </div>
  );
}

function CodeSkeleton() {
  const widths = [82, 60, 74, 40, 90, 55, 68, 35, 78, 50];
  return (
    <div style={{ padding: "20px 20px 20px 0", display: "flex", gap: 0 }}>
      {/* Gutter */}
      <div style={{ width: 48, flexShrink: 0, paddingRight: 16 }}>
        {widths.map((_, i) => (
          <div key={i} style={{
            height: 8, borderRadius: 3, width: "60%", marginLeft: "auto", marginBottom: 11,
            background: "var(--line)", opacity: 0.4,
          }} />
        ))}
      </div>
      {/* Lines */}
      <div style={{ flex: 1 }}>
        {widths.map((w, i) => (
          <div key={i} style={{
            height: 8, borderRadius: 4, width: `${w}%`, marginBottom: 11,
            backgroundImage: "linear-gradient(90deg, var(--line) 0%, var(--bg-sunken) 40%, var(--line) 80%)",
            backgroundSize: "300% 100%",
            animation: `repo-shimmer ${1.4 + i * 0.07}s ease infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── Code viewer with line numbers ───────────────────────────────────────────

function CodeViewer({ content, loading, error }: {
  content: string | null; loading: boolean; error: string | null;
}) {
  if (loading) return <CodeSkeleton />;

  if (error) return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", minHeight: 220, gap: 10, padding: 24,
    }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink-5)"
        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" /><path d="M12 8v4.5m0 3.5h.01" />
      </svg>
      <p style={{ fontSize: 12.5, color: "var(--ink-4)", fontWeight: 600, textAlign: "center", maxWidth: "40ch", lineHeight: 1.5 }}>
        {error}
      </p>
    </div>
  );

  if (content === null) return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", minHeight: 220, gap: 8, padding: 24,
    }}>
      <span style={{ color: "var(--ink-5)" }}><IcoFile /></span>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-3)", letterSpacing: "-0.01em" }}>
        Select a file please
      </p>
      <p style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-5)" }}>
        Choose a file from the tree on the left to preview it here
      </p>
    </div>
  );

  const lines = content.split("\n");
  const gutterW = Math.max(String(lines.length).length * 8 + 24, 44);

  return (
    <div
      className="repo-code-appear"
      style={{
        display: "flex", height: "100%", overflow: "auto",
        fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace",
        fontSize: 12.5, lineHeight: "21px",
      }}
    >
      {/* Gutter */}
      <div style={{
        flexShrink: 0, width: gutterW, userSelect: "none",
        paddingTop: 18, paddingBottom: 18,
        borderRight: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--bg-sunken) 70%, white)",
        position: "sticky", left: 0, zIndex: 1,
      }}>
        {lines.map((_, i) => (
          <div key={i} style={{
            paddingRight: 12, textAlign: "right",
            color: "var(--ink-5)", fontSize: 11,
            fontWeight: 500, lineHeight: "21px",
            fontVariantNumeric: "tabular-nums",
          }}>
            {i + 1}
          </div>
        ))}
      </div>

      {/* Code body */}
      <pre style={{
        flex: 1, margin: 0,
        padding: "18px 24px 18px 20px",
        color: "var(--ink-1, var(--ink-2))",
        background: "transparent", overflow: "visible",
        whiteSpace: "pre", fontSize: "inherit", lineHeight: "inherit",
        fontFamily: "inherit",
      }}>
        <code>{content}</code>
      </pre>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RepoPage() {
  const { projectId, current } = useProject();
  const [entries, setEntries] = useState<RepoEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<RepoFile | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const copyResetTimer = useRef<number | null>(null);
  const treeFetchSeq = useRef(0);
  const fileFetchSeq = useRef(0);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [zipExporting, setZipExporting] = useState(false);

  const tree = useMemo(() => buildTree(entries), [entries]);
  const projectTitle = (current?.name ?? "").trim() || "Project";
  const fileCount = useMemo(() => entries.filter((e) => e.type === "file").length, [entries]);
  const directoryCount = useMemo(() => entries.filter((e) => e.type === "directory").length, [entries]);
  const lineCount = useMemo(() => file?.content.split("\n").length ?? 0, [file]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const filteredTree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  const displayTree = useMemo((): TreeNode[] => {
    const source = searchQuery.trim() ? filteredTree : tree;
    if (!source.length) return [];
    return [{ path: VIRTUAL_TREE_PROJECT, name: projectTitle, type: "directory", size: null, children: source }];
  }, [tree, filteredTree, searchQuery, projectTitle]);

  const allExpandablePaths = useMemo(() => {
    const next = new Set<string>();
    if (tree.length) { next.add(VIRTUAL_TREE_PROJECT); collectDirectoryPaths(tree, next); }
    return next;
  }, [tree]);

  const expandedPaths = useMemo(() => {
    if (searchQuery.trim()) {
      const next = new Set<string>();
      next.add(VIRTUAL_TREE_PROJECT);
      collectDirectoryPaths(filteredTree, next);
      return next;
    }
    const next = new Set<string>();
    for (const p of allExpandablePaths) { if (!collapsedPaths.has(p)) next.add(p); }
    return next;
  }, [allExpandablePaths, collapsedPaths, searchQuery, filteredTree]);

  const getNodeTitle = useCallback(
    (node: TreeNode) => node.path === VIRTUAL_TREE_PROJECT
      ? projectTitle
      : `${projectTitle} / ${node.path.replace(/\\/g, "/")}`,
    [projectTitle]
  );

  const fileBreadcrumbs = useMemo(() => {
    const rel = (file?.path ?? selectedPath)?.trim();
    if (!rel) return null;
    return rel.replace(/\\/g, "/").split("/").filter(Boolean);
  }, [file?.path, selectedPath]);

  const fileExt = useMemo(() => {
    if (!selectedPath && !file) return null;
    const name = file?.name || (selectedPath ?? "").split("/").pop() || "";
    return getExt(name) || null;
  }, [file, selectedPath]);

  const isCopied = copiedPath === file?.path;

  const toggleDirectory = useCallback((path: string) => {
    if (path === VIRTUAL_TREE_PROJECT) return;
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path); setFile(null); setFileError(null);
    setFileLoading(true); setCopiedPath(null);
  }, []);

  useEffect(() => () => { if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current); }, []);

  const handleCopyContent = useCallback(async () => {
    if (!file?.content) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedPath(file.path);
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => { setCopiedPath(null); copyResetTimer.current = null; }, 2000);
    } catch { setCopiedPath(null); }
  }, [file]);

  const handleDownloadFile = useCallback(() => {
    if (!file?.content) return;
    const name = file.name?.trim() || file.path.split("/").filter(Boolean).pop() || "file";
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [file]);

  const handleExportZip = useCallback(async () => {
    if (!projectId) return;
    setZipExporting(true);
    try {
      const headers = new Headers();
      const token = getStoredToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const res = await fetch(
        `${getApiBase()}/team/projects/${projectId}/repo/archive.zip`,
        { headers },
      );
      if (!res.ok) {
        let message = "Could not export ZIP";
        try {
          const data = (await res.json()) as { detail?: string };
          if (data.detail) message = data.detail;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${downloadZipStem(projectTitle)}.zip`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showDashboardToast("ZIP downloaded.");
    } catch (e) {
      showDashboardToast(e instanceof Error ? e.message : "Could not export ZIP");
    } finally {
      setZipExporting(false);
    }
  }, [projectId, projectTitle]);

  const loadTree = useCallback(async () => {
    if (!projectId) {
      setEntries([]); setSelectedPath(null); setFile(null);
      setFileLoading(false); setCollapsedPaths(new Set()); setError(null); return;
    }
    const seq = ++treeFetchSeq.current;
    setTreeLoading(true); setError(null); setFileError(null);
    try {
      const rows = await apiRequest<RepoEntry[]>(`/team/projects/${projectId}/repo/tree`);
      if (seq !== treeFetchSeq.current) return;
      setEntries(rows);
      setCollapsedPaths(defaultCollapsedDirectoryPaths(buildTree(rows)));
      setFile(null);
      setFileLoading(false);
      setSelectedPath(null);
    } catch (e) {
      if (seq !== treeFetchSeq.current) return;
      setEntries([]); setSelectedPath(null); setFile(null);
      setFileLoading(false); setCollapsedPaths(new Set());
      setError(e instanceof Error ? e.message : "Could not load codebase");
    } finally {
      if (seq === treeFetchSeq.current) setTreeLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadTree(), 0);
    return () => window.clearTimeout(t);
  }, [loadTree]);

  useEffect(() => {
    if (!projectId || !selectedPath || selectedPath.startsWith("__jinoe_display__/")) {
      const seq = ++fileFetchSeq.current;
      const timer = window.setTimeout(() => {
        if (seq === fileFetchSeq.current) setFileLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const seq = ++fileFetchSeq.current;
    const timer = window.setTimeout(() => {
      setFileLoading(true);
      setFileError(null);
      void (async () => {
      try {
        const row = await apiRequest<RepoFile>(
          `/team/projects/${projectId}/repo/file?rel_path=${encodeURIComponent(selectedPath)}`
        );
        if (cancelled || seq !== fileFetchSeq.current) return;
        setFile(row);
      } catch (e) {
        if (cancelled || seq !== fileFetchSeq.current) return;
        setFile(null);
        setFileError(e instanceof Error ? e.message : "Could not load file");
      } finally {
        if (seq === fileFetchSeq.current) setFileLoading(false);
      }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, selectedPath]);

  return (
    <>
      {/* ── Global styles for this page ── */}
      <style>{`
        @keyframes repo-shimmer {
          0% { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
        @keyframes repo-spin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
        @keyframes repo-fadein {
          from { opacity: 0; transform: translateY(4px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        .repo-node {
          transition: background-color 90ms ease;
        }
        .repo-node:hover {
          background-color: var(--bg-sunken) !important;
        }
        .repo-node[aria-selected="true"]:hover {
          background-color: color-mix(in srgb, var(--accent) 14%, white) !important;
        }
        .repo-node:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .repo-code-appear {
          animation: repo-fadein 140ms ease forwards;
        }
        .repo-search:focus-within {
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--accent) 18%, transparent) !important;
        }
        .repo-btn:hover:not(:disabled) {
          border-color: var(--ink-3) !important;
          background-color: var(--bg-sunken) !important;
        }
        .repo-btn:disabled { opacity: 0.38; cursor: not-allowed; }

        /* Scrollbar polish */
        .repo-scroll::-webkit-scrollbar { width: 5px; height: 5px; }
        .repo-scroll::-webkit-scrollbar-track { background: transparent; }
        .repo-scroll::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 10px; }
        .repo-scroll::-webkit-scrollbar-thumb:hover { background: var(--ink-5); }
      `}</style>

      <main className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ${pageBg}`}>

        {/* ══ Header ══ */}
        <header style={{
          flexShrink: 0, background: "white",
          borderBottom: "1px solid var(--line)",
          padding: "18px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          {/* Left: page title only */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h1 style={{
              fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em",
              color: "var(--ink-strong)", lineHeight: 1, margin: 0,
            }}>
              Main Codebase
            </h1>
          </div>

          {/* Right: export + refresh */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => void handleExportZip()}
              disabled={!projectId || treeLoading || zipExporting}
              className="repo-btn"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                height: 30, padding: "0 11px", borderRadius: 7,
                border: "1px solid var(--line)", background: "white",
                fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)",
                cursor: "pointer", transition: "all 110ms ease", flexShrink: 0,
              }}
            >
              <IcoArchive spinning={zipExporting} />
              {zipExporting ? "Exporting…" : "Export ZIP"}
            </button>
            <button
              type="button"
              onClick={() => void loadTree()}
              disabled={!projectId || treeLoading}
              className="repo-btn"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                height: 30, padding: "0 11px", borderRadius: 7,
                border: "1px solid var(--line)", background: "white",
                fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)",
                cursor: "pointer", transition: "all 110ms ease", flexShrink: 0,
              }}
            >
              <IcoRefresh spinning={treeLoading} />
              {treeLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {/* ══ Body ══ */}
        <section style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "16px 20px" }}>
          {!projectId ? (
            <SelectProjectFirst description="Select a project in the sidebar to view its codebase." />
          ) : error ? (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 10, border: "1px solid var(--line)", background: "white",
              padding: 40, minHeight: 200,
            }}>
              <p style={{ fontSize: 13, color: "#dc2626", fontWeight: 600, textAlign: "center", maxWidth: "46ch" }}>
                {error}
              </p>
            </div>
          ) : (
            /* ── Two-column IDE layout ── */
            <div style={{
              display: "grid",
              gridTemplateColumns: "252px minmax(0, 1fr)",
              height: "100%", minHeight: 0,
              background: "white",
              borderRadius: 11,
              border: "1px solid var(--line)",
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.03)",
            }}>

              {/* ── File tree sidebar ── */}
              <aside style={{
                display: "flex", flexDirection: "column",
                borderRight: "1px solid var(--line)",
                background: "color-mix(in srgb, var(--bg-sunken) 55%, white)",
                overflow: "hidden", minHeight: 0,
              }}>
                {/* Sidebar top bar */}
                <div style={{
                  flexShrink: 0,
                  padding: "10px 10px 8px",
                  borderBottom: "1px solid var(--line)",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7,
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, color: "var(--ink-4)",
                      letterSpacing: "0.08em", textTransform: "uppercase",
                    }}>
                      Files
                    </span>
                    {!treeLoading && entries.length > 0 && (
                      <span style={{ fontSize: 10, color: "var(--ink-5)", fontWeight: 600, letterSpacing: "0.01em" }}>
                        {fileCount} files · {directoryCount} dirs
                      </span>
                    )}
                  </div>

                  {/* Search input */}
                  <div
                    className="repo-search"
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: "white", border: "1px solid var(--line)",
                      borderRadius: 7, padding: "5px 9px",
                      transition: "border-color 130ms, box-shadow 130ms",
                    }}
                  >
                    <span style={{ color: "var(--ink-4)", display: "flex", flexShrink: 0 }}>
                      <IcoSearch />
                    </span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter files…"
                      style={{
                        flex: 1, border: "none", outline: "none", background: "transparent",
                        fontSize: 11.5, color: "var(--ink-2)", fontWeight: 500,
                        minWidth: 0,
                      }}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 14, height: 14, border: "none", cursor: "pointer",
                          background: "var(--ink-4)", borderRadius: "50%",
                          color: "white", fontSize: 9, fontWeight: 800, lineHeight: 1, flexShrink: 0,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Tree body */}
                <div
                  className="repo-scroll"
                  style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "5px 5px" }}
                >
                  {treeLoading ? (
                    <TreeSkeleton />
                  ) : displayTree.length ? (
                    <div role="tree">
                      <TreeRows
                        nodes={displayTree}
                        selectedPath={selectedPath}
                        onSelectFile={handleSelectFile}
                        expandedPaths={expandedPaths}
                        onToggleDirectory={toggleDirectory}
                        getNodeTitle={getNodeTitle}
                      />
                    </div>
                  ) : searchQuery.trim() ? (
                    <p style={{ fontSize: 12, color: "var(--ink-5)", fontWeight: 500, padding: "12px 10px" }}>
                      No match for &quot;{searchQuery}&quot;
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--ink-5)", fontWeight: 500, padding: "12px 10px" }}>
                      No files found.
                    </p>
                  )}
                </div>
              </aside>

              {/* ── File viewer pane ── */}
              <section style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>

                {/* Viewer toolbar */}
                <div style={{
                  flexShrink: 0, display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 10,
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--line)",
                  background: "white", minHeight: 44,
                }}>
                  {/* File path breadcrumb */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1, overflow: "hidden" }}>
                    {fileExt && (
                      <span style={{
                        flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
                        textTransform: "uppercase", padding: "2px 7px", borderRadius: 5,
                        background: "color-mix(in srgb, var(--ink-strong) 5%, var(--bg-sunken))",
                        color: "var(--ink-3)",
                        border: "1px solid var(--line)",
                      }}>
                        .{fileExt}
                      </span>
                    )}
                    {fileBreadcrumbs ? (
                      <span style={{
                        display: "flex", alignItems: "center", flexWrap: "nowrap",
                        overflow: "hidden", minWidth: 0, gap: 0,
                        fontSize: 12, fontWeight: 500, color: "var(--ink-4)",
                        letterSpacing: "-0.01em",
                      }}>
                        {fileBreadcrumbs.map((part, i) => (
                          <span key={i} style={{ display: "flex", alignItems: "center", minWidth: 0, flexShrink: i < fileBreadcrumbs.length - 1 ? 1 : 0 }}>
                            {i > 0 && (
                              <span style={{ padding: "0 3px", color: "var(--ink-5)", fontSize: 11 }}>/</span>
                            )}
                            <span style={{
                              color: i === fileBreadcrumbs.length - 1 ? "var(--ink-strong)" : "var(--ink-4)",
                              fontWeight: i === fileBreadcrumbs.length - 1 ? 700 : 500,
                              overflow: "hidden",
                              textOverflow: i < fileBreadcrumbs.length - 1 ? "ellipsis" : "unset",
                              whiteSpace: "nowrap",
                              letterSpacing: i === fileBreadcrumbs.length - 1 ? "-0.015em" : "-0.005em",
                            }}>
                              {part}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "var(--ink-5)", fontWeight: 500 }}>
                        Select a file please
                      </span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <button
                      type="button"
                      disabled={!file || fileLoading}
                      onClick={() => void handleCopyContent()}
                      className="repo-btn"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        height: 28, padding: "0 10px", borderRadius: 6,
                        border: "1px solid var(--line)",
                        background: isCopied ? "color-mix(in srgb, var(--accent) 14%, white)" : "white",
                        fontSize: 11.5, fontWeight: 600,
                        color: isCopied ? "var(--ink-2)" : "var(--ink-3)",
                        cursor: "pointer", transition: "all 110ms ease",
                      }}
                    >
                      <IcoCopy done={isCopied} />
                      {isCopied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      type="button"
                      disabled={!file || fileLoading}
                      onClick={handleDownloadFile}
                      className="repo-btn"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        height: 28, padding: "0 10px", borderRadius: 6,
                        border: "1px solid var(--line)", background: "white",
                        fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)",
                        cursor: "pointer", transition: "all 110ms ease",
                      }}
                    >
                      <IcoDownload />
                      Download
                    </button>
                  </div>
                </div>

                {/* Code content */}
                <div
                  className="repo-scroll"
                  style={{
                    flex: 1, minHeight: 0, overflow: "auto",
                    background: "color-mix(in srgb, var(--bg-sunken) 35%, white)",
                  }}
                >
                  <CodeViewer content={file?.content ?? null} loading={fileLoading} error={fileError} />
                </div>

                {/* Status bar */}
                {(file || fileLoading) && (
                  <div style={{
                    flexShrink: 0, display: "flex", alignItems: "center", gap: 0,
                    padding: "0 14px", height: 26,
                    borderTop: "1px solid var(--line)",
                    background: "color-mix(in srgb, var(--bg-sunken) 65%, white)",
                    overflow: "hidden",
                  }}>
                    {[
                      file ? `${lineCount.toLocaleString()} lines` : null,
                      file ? formatBytes(file.size) : null,
                      fileExt ? fileExt.toUpperCase() : null,
                      "UTF-8",
                    ].filter(Boolean).map((item, i) => (
                      <span key={i} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                        {i > 0 && <span style={{ margin: "0 8px", color: "var(--line-strong)" }}>·</span>}
                        <span style={{
                          fontSize: 10, color: "var(--ink-5)", fontWeight: 600,
                          letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums",
                        }}>
                          {item}
                        </span>
                      </span>
                    ))}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-5)", fontWeight: 500 }}>
                      {fileLoading ? "Loading…" : "Read-only"}
                    </span>
                  </div>
                )}

              </section>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
