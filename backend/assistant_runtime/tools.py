from __future__ import annotations

import asyncio
import difflib
import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .config import AssistantConfig
from .schemas import AssistantTodo
if TYPE_CHECKING:
    from .targets import AssistantTarget
    from sqlalchemy.orm import Session
from .web_tools import TavilyClient


SKIP_DIRS = frozenset({".git", ".next", ".turbo", ".venv", "venv", "node_modules", "dist", "build", "__pycache__"})
READ_ONLY_GIT = frozenset({"status", "diff", "log", "show", "rev-parse", "ls-files", "grep", "blame"})
GIT_COMMAND_RE = re.compile(r"(?:^|[;&|()\s])(?:command\s+)?(?:/usr/bin/)?git\s+([a-zA-Z-]+)", re.IGNORECASE)


@dataclass
class ToolContext:
    config: AssistantConfig
    target: AssistantTarget | None
    db: Session
    user_id: int
    todos: list[dict[str, Any]]


@dataclass
class ToolExecution:
    name: str
    result: dict[str, Any]


class ToolRegistry:
    def __init__(self, config: AssistantConfig) -> None:
        self.config = config
        self.tavily = TavilyClient(config)

    def specs(self, *, workspace_enabled: bool) -> list[dict[str, Any]]:
        specs = [WEB_SEARCH_SPEC, WEB_FETCH_SPEC]
        if workspace_enabled:
            specs = [
                LIST_FILES_SPEC,
                GLOB_SPEC,
                GREP_SPEC,
                READ_FILE_SPEC,
                WRITE_FILE_SPEC,
                EDIT_FILE_SPEC,
                DELETE_FILE_SPEC,
                MOVE_FILE_SPEC,
                RUN_COMMAND_SPEC,
                TODO_UPDATE_SPEC,
                *specs,
            ]
        return specs

    async def execute(self, name: str, raw_args: str | dict[str, Any], context: ToolContext) -> ToolExecution:
        args = _decode_args(raw_args)
        try:
            if name == "list_files":
                result = self._list_files(args, context)
            elif name == "glob":
                result = self._glob(args, context)
            elif name == "grep":
                result = self._grep(args, context)
            elif name == "read_file":
                result = self._read_file(args, context)
            elif name == "write_file":
                result = self._write_file(args, context)
            elif name == "edit_file":
                result = self._edit_file(args, context)
            elif name == "delete_file":
                result = self._delete_file(args, context)
            elif name == "move_file":
                result = self._move_file(args, context)
            elif name == "run_command":
                result = self._run_command(args, context)
            elif name == "todo_update":
                result = self._todo_update(args, context)
            elif name == "web_search":
                result = await self._web_search(args)
            elif name == "web_fetch":
                result = await self._web_fetch(args)
            else:
                result = {"ok": False, "error": f"Unknown tool: {name}"}
        except Exception as exc:  # noqa: BLE001 - tool failures must go back to the model.
            result = {"ok": False, "error": str(exc)}
        return ToolExecution(name=name, result=_trim_result(result, self.config.max_tool_output_chars))

    async def stream_command(
        self,
        raw_args: str | dict[str, Any],
        context: ToolContext,
    ) -> AsyncGenerator[dict[str, Any], None]:
        args = _decode_args(raw_args)
        try:
            command_meta = self._prepare_command(args, context)
        except Exception as exc:  # noqa: BLE001 - command failures must stay structured.
            yield {"kind": "result", "result": {"ok": False, "error": str(exc)}}
            return

        process = await asyncio.create_subprocess_exec(
            *command_meta["argv"],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        output_parts: list[str] = []
        observed_chars = 0

        async def drain(stream_name: str, reader: asyncio.StreamReader | None) -> None:
            nonlocal observed_chars
            if reader is None:
                return
            while True:
                chunk = await reader.read(1024)
                if not chunk:
                    return
                text = chunk.decode("utf-8", errors="replace")
                if observed_chars < self.config.max_tool_output_chars:
                    remaining = self.config.max_tool_output_chars - observed_chars
                    kept = text[:remaining]
                    if kept:
                        output_parts.append(kept)
                        observed_chars += len(kept)
                await queue.put({"kind": "log", "stream": stream_name, "chunk": text})

        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        stdout_task = asyncio.create_task(drain("stdout", process.stdout))
        stderr_task = asyncio.create_task(drain("stderr", process.stderr))
        wait_task = asyncio.create_task(process.wait())
        timed_out = False
        deadline = asyncio.get_running_loop().time() + float(command_meta["timeout"])

        try:
            while True:
                if wait_task.done() and stdout_task.done() and stderr_task.done() and queue.empty():
                    break
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    timed_out = True
                    process.kill()
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=min(0.15, remaining))
                except asyncio.TimeoutError:
                    continue
                yield item
            return_code = await process.wait() if timed_out else await wait_task
        except asyncio.CancelledError:
            if process.returncode is None:
                process.kill()
                await process.wait()
            raise
        finally:
            for task in (stdout_task, stderr_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)

        output = "".join(output_parts).strip() or "(no output)"
        if observed_chars >= self.config.max_tool_output_chars:
            output = f"{output}\n\n[output truncated]"
        result = {
            "ok": (return_code == 0) and not timed_out,
            "command": command_meta["command"],
            "cwd": command_meta["cwd"],
            "exit_code": return_code,
            "timed_out": timed_out,
            "output": output,
        }
        yield {"kind": "result", "result": _trim_result(result, self.config.max_tool_output_chars)}

    def _list_files(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        return self._container_file_tool(
            "list_files",
            {
                "path": str(args.get("path") or "."),
                "max_entries": _bounded_int(args.get("max_entries"), 120, 1, 500),
            },
            context,
        )

    def _glob(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        pattern = str(args.get("pattern") or "").strip()
        if not pattern:
            raise ValueError("glob requires a pattern")
        return self._container_file_tool(
            "glob",
            {
                "pattern": pattern,
                "path": str(args.get("path") or "."),
                "max_entries": _bounded_int(args.get("max_entries"), 200, 1, 1_000),
            },
            context,
        )

    def _grep(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        pattern = str(args.get("pattern") or "")
        if not pattern:
            raise ValueError("grep requires a pattern")
        return self._container_file_tool(
            "grep",
            {
                "pattern": pattern,
                "path": str(args.get("path") or "."),
                "glob": str(args.get("glob") or "").strip(),
                "max_matches": _bounded_int(args.get("max_matches"), 80, 1, 300),
            },
            context,
        )

    def _read_file(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        return self._container_file_tool(
            "read_file",
            {
                "path": str(args.get("path") or ""),
                "offset": _bounded_int(args.get("offset"), 1, 1, 1_000_000),
                "limit": _bounded_int(args.get("limit"), 240, 1, 1_000),
                "max_bytes": _bounded_int(args.get("max_bytes"), self.config.max_file_read_bytes, 1, self.config.max_file_read_bytes),
            },
            context,
        )

    def _write_file(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        content = str(args.get("content") or "")
        if len(content.encode("utf-8")) > self.config.max_file_write_bytes:
            raise ValueError("write_file content is too large")
        return self._container_file_tool("write_file", {"path": str(args.get("path") or ""), "content": content}, context)

    def _edit_file(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        old_text = str(args.get("old_text") or "")
        new_text = str(args.get("new_text") or "")
        if not old_text:
            raise ValueError("edit_file old_text cannot be empty")
        if len(new_text.encode("utf-8")) > self.config.max_file_write_bytes:
            raise ValueError("edit_file new_text is too large")
        return self._container_file_tool(
            "edit_file",
            {"path": str(args.get("path") or ""), "old_text": old_text, "new_text": new_text},
            context,
        )

    def _delete_file(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        return self._container_file_tool("delete_file", {"path": str(args.get("path") or "")}, context)

    def _move_file(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        return self._container_file_tool(
            "move_file",
            {"source": str(args.get("source") or ""), "destination": str(args.get("destination") or "")},
            context,
        )

    def _run_command(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        command_meta = self._prepare_command(args, context)
        completed = subprocess.run(
            command_meta["argv"],
            capture_output=True,
            text=True,
            timeout=command_meta["timeout"],
            check=False,
        )
        output = "\n".join(part for part in [completed.stdout, completed.stderr] if part).strip()
        return {
            "ok": completed.returncode == 0,
            "command": command_meta["command"],
            "cwd": command_meta["cwd"],
            "exit_code": completed.returncode,
            "output": output or "(no output)",
        }

    def _prepare_command(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        target = _workspace_target(context)
        container = target.container_name
        if not container:
            raise RuntimeError("The editor container is not open. Reopen the editor and try again.")
        docker = shutil.which("docker")
        if not docker:
            raise RuntimeError("Docker is not available to run workspace commands.")
        command = str(args.get("command") or "").strip()
        if not command:
            raise ValueError("run_command requires a command")
        _assert_safe_git_command(command)
        cwd = str(args.get("cwd") or ".").strip() or "."
        _safe_path(target.root_path, cwd, allow_root=True)
        timeout = _bounded_int(args.get("timeout_seconds"), self.config.max_command_seconds, 1, self.config.max_command_seconds)
        inner_cwd = "/home/coder/project" if cwd == "." else f"/home/coder/project/{cwd.strip('/')}"
        argv = [docker, "exec", "-w", inner_cwd, container, "sh", "-lc", command]
        return {"argv": argv, "command": command, "cwd": cwd, "timeout": timeout}

    def _todo_update(self, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        raw = args.get("todos")
        if not isinstance(raw, list):
            raise ValueError("todo_update requires a todos array")
        todos = [AssistantTodo.model_validate(item).model_dump() for item in raw[:40]]
        context.todos[:] = todos
        return {"ok": True, "todos": todos, "count": len(todos)}

    def _container_file_tool(self, operation: str, args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
        target = _workspace_target(context)
        container = target.container_name
        if not container:
            raise RuntimeError("The editor container is not open. Reopen the editor and try again.")
        docker = shutil.which("docker")
        if not docker:
            raise RuntimeError("Docker is not available to access workspace files.")
        payload = {
            "operation": operation,
            "args": args,
            "limits": {
                "max_file_read_bytes": self.config.max_file_read_bytes,
                "max_file_write_bytes": self.config.max_file_write_bytes,
            },
        }
        completed = subprocess.run(
            [docker, "exec", "-i", "-w", "/home/coder/project", container, "python3", "-c", CONTAINER_FILE_TOOL_SCRIPT],
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=self.config.max_command_seconds,
            check=False,
        )
        raw = (completed.stdout or "").strip()
        if completed.returncode != 0:
            detail = (completed.stderr or raw or "Workspace file operation failed.").strip()
            raise RuntimeError(detail[-1_200:])
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("Workspace file operation returned invalid data.") from exc
        if not isinstance(result, dict):
            raise RuntimeError("Workspace file operation returned invalid data.")
        if result.get("ok") is False:
            raise RuntimeError(str(result.get("error") or "Workspace file operation failed."))
        return result

    async def _web_search(self, args: dict[str, Any]) -> dict[str, Any]:
        query = str(args.get("query") or "").strip()
        if not query:
            raise ValueError("web_search requires a query")
        max_results = _bounded_int(args.get("max_results"), 5, 1, 10)
        data = await self.tavily.search(query, max_results=max_results)
        return {"ok": True, "query": query, "results": data.get("results", [])}

    async def _web_fetch(self, args: dict[str, Any]) -> dict[str, Any]:
        raw_urls = args.get("urls")
        urls = [str(url).strip() for url in raw_urls] if isinstance(raw_urls, list) else [str(args.get("url") or "").strip()]
        urls = [url for url in urls if url.startswith(("http://", "https://"))]
        if not urls:
            raise ValueError("web_fetch requires at least one http(s) URL")
        data = await self.tavily.extract(urls)
        return {"ok": True, "results": data.get("results", []), "failed_results": data.get("failed_results", [])}


def _decode_args(raw_args: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(raw_args, dict):
        return raw_args
    if not raw_args:
        return {}
    value = json.loads(raw_args)
    if not isinstance(value, dict):
        raise ValueError("Tool arguments must be a JSON object")
    return value


CONTAINER_FILE_TOOL_SCRIPT = r'''
import difflib
import glob as globlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {".git", ".next", ".turbo", ".venv", "venv", "node_modules", "dist", "build", "__pycache__"}
ROOT = Path("/home/coder/project").resolve()


def fail(message):
    print(json.dumps({"ok": False, "error": str(message)}, ensure_ascii=False))
    sys.exit(0)


def safe_path(raw, allow_root=False, require_file_shape=False):
    cleaned = str(raw or "").strip().replace("\\", "/")
    if "\x00" in cleaned or cleaned.startswith("/"):
        raise ValueError("Path must stay inside the workspace.")
    if not cleaned or cleaned == ".":
        if not allow_root:
            raise ValueError("A file path is required.")
        return ROOT
    if any(part == ".." for part in cleaned.split("/")):
        raise ValueError("Path traversal is not allowed.")
    if require_file_shape and cleaned.endswith("/"):
        raise ValueError("A file path is required, not a directory path.")
    target = (ROOT / cleaned).resolve(strict=False)
    target.relative_to(ROOT)
    if ".git" in target.relative_to(ROOT).parts:
        raise ValueError("Direct .git access is not allowed.")
    return target


def display_path(path):
    rendered = path.resolve(strict=False).relative_to(ROOT).as_posix()
    return rendered if rendered != "." else "."


def write_result(target, previous, updated):
    diff_lines = list(
        difflib.unified_diff(
            previous.splitlines(),
            updated.splitlines(),
            fromfile=f"a/{display_path(target)}",
            tofile=f"b/{display_path(target)}",
            lineterm="",
        )
    )
    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
    return {
        "ok": True,
        "path": display_path(target),
        "changed": previous != updated,
        "added": added,
        "removed": removed,
        "diff": "\n".join(diff_lines),
    }


def bounded_int(raw, default, minimum, maximum):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


try:
    payload = json.loads(sys.stdin.read() or "{}")
    op = payload.get("operation")
    args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
    limits = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    max_read = bounded_int(limits.get("max_file_read_bytes"), 2_000_000, 1, 20_000_000)
    max_write = bounded_int(limits.get("max_file_write_bytes"), 2_000_000, 1, 20_000_000)

    if op == "list_files":
        base = safe_path(args.get("path") or ".", allow_root=True)
        if not base.is_dir():
            raise ValueError("list_files requires a directory path")
        max_entries = bounded_int(args.get("max_entries"), 120, 1, 500)
        entries = []
        for child in sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name in SKIP_DIRS:
                continue
            entries.append({"path": display_path(child), "type": "directory" if child.is_dir() else "file"})
            if len(entries) >= max_entries:
                break
        result = {"ok": True, "entries": entries, "count": len(entries)}

    elif op == "glob":
        pattern = str(args.get("pattern") or "").strip()
        if not pattern:
            raise ValueError("glob requires a pattern")
        base = safe_path(args.get("path") or ".", allow_root=True)
        if not base.is_dir():
            raise ValueError("glob search base must be a directory")
        max_entries = bounded_int(args.get("max_entries"), 200, 1, 1_000)
        matches = []
        for raw_match in sorted(globlib.glob(pattern, root_dir=base, recursive=True)):
            candidate = (base / raw_match).resolve(strict=False)
            try:
                rel = candidate.relative_to(ROOT)
            except ValueError:
                continue
            if any(part in SKIP_DIRS for part in rel.parts):
                continue
            matches.append(display_path(candidate))
            if len(matches) >= max_entries:
                break
        result = {"ok": True, "matches": matches, "count": len(matches)}

    elif op == "grep":
        pattern = str(args.get("pattern") or "")
        if not pattern:
            raise ValueError("grep requires a pattern")
        base = safe_path(args.get("path") or ".", allow_root=True)
        if not base.is_dir():
            raise ValueError("grep search base must be a directory")
        rg = shutil.which("rg")
        if not rg:
            raise RuntimeError("ripgrep is not installed in the workspace container")
        argv = [rg, "--line-number", "--column", "--no-heading", "--color", "never", pattern]
        glob_value = str(args.get("glob") or "").strip()
        if glob_value:
            argv.extend(["--glob", glob_value])
        completed = subprocess.run(argv, cwd=str(base), capture_output=True, text=True, timeout=45, check=False)
        lines = (completed.stdout or "").splitlines()
        limit = bounded_int(args.get("max_matches"), 80, 1, 300)
        result = {"ok": True, "matches": lines[:limit], "count": min(len(lines), limit), "truncated": len(lines) > limit}

    elif op == "read_file":
        target = safe_path(args.get("path") or "")
        if not target.is_file():
            raise ValueError("read_file requires an existing file")
        max_bytes = bounded_int(args.get("max_bytes"), max_read, 1, max_read)
        data = target.read_bytes()
        truncated_bytes = len(data) > max_bytes
        data = data[:max_bytes]
        if b"\x00" in data:
            raise ValueError("read_file cannot preview binary files")
        lines = data.decode("utf-8", errors="replace").splitlines()
        offset = bounded_int(args.get("offset"), 1, 1, max(1, len(lines) + 1))
        limit = bounded_int(args.get("limit"), 240, 1, 1_000)
        selected = lines[offset - 1 : offset - 1 + limit]
        content = "\n".join(f"{line_no}|{line}" for line_no, line in enumerate(selected, start=offset))
        result = {
            "ok": True,
            "path": display_path(target),
            "content": content,
            "line_count": len(lines),
            "truncated": truncated_bytes or offset - 1 + limit < len(lines),
        }

    elif op == "write_file":
        target = safe_path(args.get("path") or "", require_file_shape=True)
        content = str(args.get("content") or "")
        if len(content.encode("utf-8")) > max_write:
            raise ValueError("write_file content is too large")
        previous = target.read_text(encoding="utf-8", errors="replace") if target.exists() else ""
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        result = write_result(target, previous, content)

    elif op == "edit_file":
        target = safe_path(args.get("path") or "", require_file_shape=True)
        if not target.is_file():
            raise ValueError("edit_file requires an existing file")
        old_text = str(args.get("old_text") or "")
        new_text = str(args.get("new_text") or "")
        if not old_text:
            raise ValueError("edit_file old_text cannot be empty")
        previous = target.read_text(encoding="utf-8", errors="replace")
        matches = previous.count(old_text)
        if matches != 1:
            raise ValueError(f"edit_file old_text must match exactly once; found {matches}")
        updated = previous.replace(old_text, new_text, 1)
        if len(updated.encode("utf-8")) > max_write:
            raise ValueError("edit_file output is too large")
        target.write_text(updated, encoding="utf-8")
        result = {**write_result(target, previous, updated), "replacements": 1}

    elif op == "delete_file":
        target = safe_path(args.get("path") or "", require_file_shape=True)
        if not target.is_file():
            raise ValueError("delete_file only deletes existing files")
        target.unlink()
        result = {"ok": True, "path": display_path(target), "deleted": True}

    elif op == "move_file":
        source = safe_path(args.get("source") or "", require_file_shape=True)
        destination = safe_path(args.get("destination") or "", require_file_shape=True)
        if not source.is_file():
            raise ValueError("move_file requires an existing source file")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
        result = {"ok": True, "source": display_path(source), "destination": display_path(destination)}

    else:
        raise ValueError(f"Unknown workspace file operation: {op}")

    print(json.dumps(result, ensure_ascii=False))
except Exception as exc:
    fail(exc)
'''


def _workspace_target(context: ToolContext) -> AssistantTarget:
    if context.target is None:
        raise RuntimeError("This tool requires an open Jinoe workspace editor.")
    return context.target


def _workspace_root(context: ToolContext) -> Path:
    return _workspace_target(context).root_path.resolve()


def _safe_path(root: Path, raw: str, *, allow_root: bool = False, require_file_shape: bool = False) -> Path:
    cleaned = raw.strip().replace("\\", "/")
    if "\x00" in cleaned or cleaned.startswith("/"):
        raise ValueError("Path must stay inside the workspace.")
    if not cleaned or cleaned == ".":
        if not allow_root:
            raise ValueError("A file path is required.")
        return root
    if any(part == ".." for part in cleaned.split("/")):
        raise ValueError("Path traversal is not allowed.")
    if require_file_shape and cleaned.endswith("/"):
        raise ValueError("A file path is required, not a directory path.")
    target = (root / cleaned).resolve(strict=False)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("Path escapes the workspace.") from exc
    if any(part == ".git" for part in target.relative_to(root).parts):
        raise ValueError("Direct .git access is not allowed.")
    return target


def _display_path(root: Path, path: Path) -> str:
    rel = path.resolve(strict=False).relative_to(root)
    rendered = rel.as_posix()
    return rendered if rendered != "." else "."


def _bounded_int(raw: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _assert_safe_git_command(command: str) -> None:
    for match in GIT_COMMAND_RE.finditer(command):
        subcommand = match.group(1).lower()
        if subcommand not in READ_ONLY_GIT:
            raise ValueError(
                "Git write operations are handled by Jinoe. Use read-only Git inspection only; "
                "to submit work, ask the user to press Done in the top right."
            )


def _write_result(root: Path, target: Path, previous: str, updated: str) -> dict[str, Any]:
    previous_lines = previous.splitlines()
    updated_lines = updated.splitlines()
    diff_lines = list(
        difflib.unified_diff(
            previous_lines,
            updated_lines,
            fromfile=f"a/{_display_path(root, target)}",
            tofile=f"b/{_display_path(root, target)}",
            lineterm="",
        )
    )
    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
    return {
        "ok": True,
        "path": _display_path(root, target),
        "changed": previous != updated,
        "added": added,
        "removed": removed,
        "diff": "\n".join(diff_lines),
    }


def _trim_result(result: dict[str, Any], limit: int) -> dict[str, Any]:
    serialized = json.dumps(result, ensure_ascii=False, default=str)
    if len(serialized) <= limit:
        return result
    return {
        "ok": result.get("ok", True),
        "truncated": True,
        "preview": serialized[:limit],
    }


def _spec(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


LIST_FILES_SPEC = _spec("list_files", "List files and folders under a workspace directory.", {"path": {"type": "string"}, "max_entries": {"type": "integer"}}, [])
GLOB_SPEC = _spec("glob", "Find workspace files matching a glob pattern.", {"pattern": {"type": "string"}, "path": {"type": "string"}, "max_entries": {"type": "integer"}}, ["pattern"])
GREP_SPEC = _spec("grep", "Search workspace file contents with ripgrep-style pattern matching.", {"pattern": {"type": "string"}, "path": {"type": "string"}, "glob": {"type": "string"}, "max_matches": {"type": "integer"}}, ["pattern"])
READ_FILE_SPEC = _spec("read_file", "Read a text file with line numbers.", {"path": {"type": "string"}, "offset": {"type": "integer"}, "limit": {"type": "integer"}, "max_bytes": {"type": "integer"}}, ["path"])
WRITE_FILE_SPEC = _spec("write_file", "Create or replace one UTF-8 workspace file.", {"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"])
EDIT_FILE_SPEC = _spec("edit_file", "Replace one exact text range in an existing workspace file.", {"path": {"type": "string"}, "old_text": {"type": "string"}, "new_text": {"type": "string"}}, ["path", "old_text", "new_text"])
DELETE_FILE_SPEC = _spec("delete_file", "Delete one workspace file.", {"path": {"type": "string"}}, ["path"])
MOVE_FILE_SPEC = _spec("move_file", "Move or rename one workspace file.", {"source": {"type": "string"}, "destination": {"type": "string"}}, ["source", "destination"])
RUN_COMMAND_SPEC = _spec("run_command", "Run a terminal command inside the active editor Docker container. Git mutations are not allowed.", {"command": {"type": "string"}, "cwd": {"type": "string"}, "timeout_seconds": {"type": "integer"}}, ["command"])
TODO_UPDATE_SPEC = _spec("todo_update", "Replace the current short assistant todo list for this work session.", {"todos": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "content": {"type": "string"}, "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]}}, "required": ["id", "content", "status"], "additionalProperties": False}}}, ["todos"])
WEB_SEARCH_SPEC = _spec("web_search", "Search the public web when current external information is needed.", {"query": {"type": "string"}, "max_results": {"type": "integer"}}, ["query"])
WEB_FETCH_SPEC = _spec("web_fetch", "Extract readable content from one or more public web URLs.", {"url": {"type": "string"}, "urls": {"type": "array", "items": {"type": "string"}}}, [])
