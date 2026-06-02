# Jinoe Assistant Tools

This manifest mirrors the backend tool registry used by the coding assistant.
Tool schemas in `tools.py` remain the runtime source of truth.

## Workspace Tools

- `list_files`: list files and folders under the active workspace.
- `glob`: find files by glob pattern.
- `grep`: search workspace file contents.
- `read_file`: read UTF-8 text files with line numbers.
- `write_file`: create or replace one file.
- `edit_file`: replace one exact text region in one file.
- `delete_file`: delete one file.
- `move_file`: rename or move one file inside the workspace.
- `run_command`: run shell commands inside the active VS Code Docker container.
- `todo_update`: replace the assistant's short execution todo list.

## Web Tools

- `web_search`: search the public web through Tavily.
- `web_fetch`: extract readable content from public URLs through Tavily.

## Guardrails

- File tools reject path traversal, absolute paths, direct `.git` access, and symlink escapes.
- Command execution requires an open editor container.
- Git inspection is allowed through `run_command`.
- Git mutations are rejected. Users submit task work with Jinoe's Done button.

