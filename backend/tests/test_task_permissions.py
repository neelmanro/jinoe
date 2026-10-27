from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException, status

from task_workflow import _ensure_can_work_task


def test_owner_can_work_any_task_assignment() -> None:
    task = SimpleNamespace(assignee_user_id=42)

    _ensure_can_work_task("owner", task, user_id=7)


@pytest.mark.parametrize("assignee_user_id", [None, 7])
def test_collaborator_can_work_unassigned_or_self_assigned_task(assignee_user_id: int | None) -> None:
    task = SimpleNamespace(assignee_user_id=assignee_user_id)

    _ensure_can_work_task("collaborator", task, user_id=7)


def test_collaborator_cannot_work_task_assigned_to_someone_else() -> None:
    task = SimpleNamespace(assignee_user_id=42)

    with pytest.raises(HTTPException) as exc_info:
        _ensure_can_work_task("collaborator", task, user_id=7)

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert exc_info.value.detail == "This task is assigned to someone else"
