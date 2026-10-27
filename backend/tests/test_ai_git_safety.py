from __future__ import annotations

import pytest

from assistant_runtime.tools import _assert_safe_git_command


@pytest.mark.parametrize(
    "command",
    [
        "git status --short",
        "git diff -- src/app.ts",
        "git log --oneline -5",
        "git show HEAD:README.md",
        "command git rev-parse HEAD",
        "/usr/bin/git ls-files",
        "'/opt/homebrew/bin/git' blame backend/task_workflow.py",
    ],
)
def test_git_read_only_inspection_commands_are_allowed(command: str) -> None:
    _assert_safe_git_command(command)


@pytest.mark.parametrize(
    "command",
    [
        "git commit -m 'ship it'",
        "git status && git commit -m 'ship it'",
        "/bin/git merge feature-branch",
        '"/usr/bin/git" push origin HEAD',
        "command git add -A",
        "g\\it commit -m 'hidden with shell escape'",
        "git\\\n commit -m 'hidden with line continuation'",
    ],
)
def test_git_mutations_are_rejected_even_when_chained_or_path_qualified(command: str) -> None:
    with pytest.raises(ValueError, match="Git write operations are handled by Jinoe"):
        _assert_safe_git_command(command)


def test_later_write_after_allowed_read_is_rejected() -> None:
    with pytest.raises(ValueError, match="Git write operations are handled by Jinoe"):
        _assert_safe_git_command("git diff --stat; echo reviewed; git push origin HEAD")
