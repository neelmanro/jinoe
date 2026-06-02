#########################################################################################################################
# TASK API — routes and helpers (ORM / Pydantic models live in main.py)
#########################################################################################################################

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session
from starlette.responses import Response

from auth import CurrentUser, _ensure_membership, _membership
from main import AiTaskRun, AiTaskRunOut, Db, Task, TaskCreateIn, TaskOut, TaskTagOut, TaskUpdateIn, User

from project import _get_project_for_member, _require_project_roster

router = APIRouter(tags=["tasks"])


def _task_assignee_label(db: Session, t: Task) -> str:
    if t.assignee_user_id:
        u = db.get(User, t.assignee_user_id)
        return u.full_name if u else "Unknown"
    if t.assignee_label:
        return t.assignee_label
    return "Unassigned"


def _parse_task_tags(raw: object) -> list[TaskTagOut]:
    if not isinstance(raw, list):
        return []
    out: list[TaskTagOut] = []
    for item in raw:
        if isinstance(item, dict) and "label" in item and "tone" in item:
            out.append(TaskTagOut(label=str(item["label"]), tone=str(item["tone"])))
    return out


def task_to_out(db: Session, t: Task) -> TaskOut:
    ai_run = db.scalars(
        select(AiTaskRun)
        .where(AiTaskRun.task_id == t.id)
        .order_by(AiTaskRun.updated_at.desc(), AiTaskRun.id.desc())
        .limit(1)
    ).first()
    return TaskOut(
        id=t.id,
        project_id=t.project_id,
        ref=t.ref,
        title=t.title,
        body=t.body,
        status=t.status,  # type: ignore[arg-type]
        tags=_parse_task_tags(t.tags),
        progress=t.progress,
        assignee_user_id=t.assignee_user_id,
        assignee=_task_assignee_label(db, t),
        due_at=t.due_at,
        shipped=t.shipped,
        comments_count=t.comments_count,
        ai_run=ai_run_to_out(ai_run) if ai_run is not None else None,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def ai_run_to_out(run: AiTaskRun) -> AiTaskRunOut:
    return AiTaskRunOut(
        id=run.id,
        project_id=run.project_id,
        task_id=run.task_id,
        attempt_id=run.attempt_id,
        session_id=run.session_id,
        status=run.status,
        current_step=run.current_step,
        progress=run.progress,
        todos=run.todos if isinstance(run.todos, list) else [],
        events=run.events if isinstance(run.events, list) else [],
        logs=run.logs,
        error=run.error,
        review_id=run.review_id,
        created_at=run.created_at,
        updated_at=run.updated_at,
        completed_at=run.completed_at,
    )


def _next_task_ref(db: Session, project_id: int) -> str:
    n = int(db.scalar(select(func.count(Task.id)).where(Task.project_id == project_id)) or 0)
    return f"T-{n + 1:04d}"


def _ensure_assignee_in_team(db: Session, team_id: int, assignee_user_id: int | None) -> None:
    if assignee_user_id is None:
        return
    m = _membership(db, assignee_user_id)
    if not m or m.team_id != team_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assignee must be a member of this workspace",
        )


@router.get("/team/projects/{project_id}/tasks", response_model=list[TaskOut])
def list_project_tasks(project_id: int, current_user: CurrentUser, db: Db) -> list[TaskOut]:
    member = _ensure_membership(db, current_user)
    p = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, p, member)
    status_order = case(
        (Task.status == "todo", 0),
        (Task.status == "doing", 1),
        (Task.status == "review", 2),
        (Task.status == "shipped", 3),
        else_=4,
    )
    tasks = list(
        db.scalars(
            select(Task)
            .where(Task.project_id == p.id)
            .order_by(status_order, Task.sort_order.asc(), Task.id.asc())
        ).all()
    )
    return [task_to_out(db, t) for t in tasks]


@router.post("/team/projects/{project_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_project_task(
    project_id: int, body: TaskCreateIn, current_user: CurrentUser, db: Db
) -> TaskOut:
    member = _ensure_membership(db, current_user)
    p = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, p, member)
    _ensure_assignee_in_team(db, member.team_id, body.assignee_user_id)
    ref = _next_task_ref(db, p.id)
    tag_json: list[dict[str, str]] = [{"label": t.label, "tone": t.tone} for t in body.tags]
    t = Task(
        project_id=p.id,
        ref=ref,
        title=body.title.strip(),
        body=(body.body.strip() if body.body else None),
        status=body.status,
        tags=tag_json,
        progress=body.progress,
        assignee_user_id=body.assignee_user_id,
        assignee_label=(body.assignee_label.strip() if body.assignee_label else None),
        due_at=body.due_at,
        shipped=body.shipped,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return task_to_out(db, t)


@router.patch("/team/projects/{project_id}/tasks/{task_id}", response_model=TaskOut)
def update_project_task(
    project_id: int, task_id: int, body: TaskUpdateIn, current_user: CurrentUser, db: Db
) -> TaskOut:
    member = _ensure_membership(db, current_user)
    p = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, p, member)
    t = db.get(Task, task_id)
    if not t or t.project_id != p.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    u = body.model_dump(exclude_unset=True)
    if "assignee_user_id" in u:
        _ensure_assignee_in_team(db, member.team_id, u["assignee_user_id"])
    if "title" in u and u["title"] is not None:
        t.title = u["title"].strip()
    if "body" in u:
        if u["body"] is None:
            t.body = None
        else:
            t.body = str(u["body"]).strip() or None
    if "status" in u and u["status"] is not None:
        t.status = u["status"]
    if "tags" in u and u["tags"] is not None:
        t.tags = [{"label": x["label"], "tone": x["tone"]} for x in u["tags"]]
    if "progress" in u:
        t.progress = u["progress"]
    if "assignee_user_id" in u:
        t.assignee_user_id = u["assignee_user_id"]
    if "assignee_label" in u:
        al = u["assignee_label"]
        t.assignee_label = None if al is None else (str(al).strip() or None)
    if "due_at" in u:
        t.due_at = u["due_at"]
    if "shipped" in u and u["shipped"] is not None:
        t.shipped = u["shipped"]
    t.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(t)
    return task_to_out(db, t)


@router.delete(
    "/team/projects/{project_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_project_task(project_id: int, task_id: int, current_user: CurrentUser, db: Db) -> Response:
    member = _ensure_membership(db, current_user)
    p = _get_project_for_member(db, member, project_id)
    _require_project_roster(db, p, member)
    t = db.get(Task, task_id)
    if not t or t.project_id != p.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    db.delete(t)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
