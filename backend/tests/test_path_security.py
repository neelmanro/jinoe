from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException, status

from assistant_runtime.tools import _safe_path
from project import _safe_repo_child


def test_assistant_safe_path_resolves_normal_relative_paths(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    assert _safe_path(workspace, ".", allow_root=True) == workspace.resolve()
    assert _safe_path(workspace, "src/app.ts") == workspace.resolve() / "src" / "app.ts"
    assert _safe_path(workspace, "src\\app.ts") == workspace.resolve() / "src" / "app.ts"


@pytest.mark.parametrize(
    "raw_path, expected_message",
    [
        ("", "A file path is required"),
        ("../secret.txt", "Path traversal is not allowed"),
        ("src/../../secret.txt", "Path traversal is not allowed"),
        ("/tmp/secret.txt", "Path must stay inside the workspace"),
        ("src/.git/config", "Direct .git access is not allowed"),
        ("src/.GIT/config", "Direct .git access is not allowed"),
        ("bad\x00name.txt", "Path must stay inside the workspace"),
        ("src/", "A file path is required, not a directory path"),
    ],
)
def test_assistant_safe_path_rejects_workspace_escape_and_git_internals(
    tmp_path: Path,
    raw_path: str,
    expected_message: str,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    with pytest.raises(ValueError, match=expected_message):
        _safe_path(workspace, raw_path, require_file_shape=True)


def test_assistant_safe_path_rejects_symlink_escape(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "linked").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="Path escapes the workspace"):
        _safe_path(workspace, "linked/secret.txt")


def test_repo_safe_child_normalizes_relative_paths(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()

    assert _safe_repo_child(repo, "./src//app.ts") == repo.resolve() / "src" / "app.ts"
    assert _safe_repo_child(repo, "src\\app.ts") == repo.resolve() / "src" / "app.ts"


@pytest.mark.parametrize(
    "raw_path",
    [
        "",
        ".",
        "../secret.txt",
        "src/../../secret.txt",
        ".git/config",
        ".GIT/config",
        "bad\x00name.txt",
    ],
)
def test_repo_safe_child_rejects_invalid_paths(tmp_path: Path, raw_path: str) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()

    with pytest.raises(HTTPException) as exc_info:
        _safe_repo_child(repo, raw_path)

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "That file path isn’t allowed."


def test_repo_safe_child_rejects_symlink_escape(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    outside = tmp_path / "outside"
    repo.mkdir()
    outside.mkdir()
    (repo / "linked").symlink_to(outside, target_is_directory=True)

    with pytest.raises(HTTPException) as exc_info:
        _safe_repo_child(repo, "linked/secret.txt")

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
