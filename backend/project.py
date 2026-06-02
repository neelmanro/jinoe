#########################################################################################################################
# IMPORTS
#########################################################################################################################

from __future__ import annotations
import io
import zipfile
from pathlib import Path
import re
import unicodedata
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.responses import Response, StreamingResponse
from auth import CurrentUser, _ensure_membership
from main import Db, Project, ProjectCreateIn, ProjectMember, ProjectMemberAddIn, ProjectMemberOut, ProjectOut, ProjectPatchIn, ProjectSetupStatusOut, RepoEntryOut, RepoFileOut, TeamMember, User
from project_setup import create_empty_project_workspace

#########################################################################################################################
# END IMPORTS
#########################################################################################################################

#########################################################################################################################
# PROJECT HELPERS
#########################################################################################################################

router = APIRouter(tags=["projects"])

PROJECT_COLORS = [
    "#4f46e5",
    "#0d9488",
    "#7c3aed",
    "#ea580c",
    "#2563eb",
    "#db2777",
    "#059669",
]

REPO_EXCLUDED_DIRS = {
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "env",
    "node_modules",
    "venv",
}

REPO_MAX_ENTRIES = 1_500
REPO_MAX_FILE_BYTES = 500_000
# Text preview limit is small; ZIP export allows larger individual files.
REPO_ZIP_MAX_FILE_BYTES = 25 * 1024 * 1024
REPO_ZIP_MAX_FILES = REPO_MAX_ENTRIES


def _color_for_new_project_count(count: int) -> str:
    return PROJECT_COLORS[count % len(PROJECT_COLORS)]


def list_projects_for_team_member(
    db: Session,
    member: TeamMember,
    user_id: int,
) -> list[Project]:
    query = select(Project).where(Project.team_id == member.team_id)

    if member.role != "owner":
        query = query.join(
            ProjectMember,
            ProjectMember.project_id == Project.id,
        ).where(ProjectMember.user_id == user_id)

    return list(
        db.scalars(
            query.order_by(Project.name.asc(), Project.id.asc())
        ).all()
    )


def _team_user_ids(db: Session, team_id: int) -> set[int]:
    return set(
        db.scalars(
            select(TeamMember.user_id).where(
                TeamMember.team_id == team_id
            )
        ).all()
    )


def _get_project_for_member(
    db: Session,
    member: TeamMember,
    project_id: int,
) -> Project:
    project = db.get(Project, project_id)

    if not project or project.team_id != member.team_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


def _user_on_project_roster(
    db: Session,
    project_id: int,
    user_id: int,
) -> bool:
    return (
        db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
        is not None
    )


def _require_project_roster(
    db: Session,
    project: Project,
    member: TeamMember,
) -> None:
    if member.role == "owner":
        return

    if _user_on_project_roster(db, project.id, member.user_id):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You must be added to this project to use tasks.",
    )


def _ensure_project_visible_to_member(
    db: Session,
    project: Project,
    member: TeamMember,
) -> None:
    if member.role == "owner":
        return

    _require_project_roster(db, project, member)


def _add_project_members_for_new(
    db: Session,
    project: Project,
    team_id: int,
    creator: User,
    extra_user_ids: list[int],
) -> None:
    allowed = _team_user_ids(db, team_id)
    wanted: set[int] = {creator.id}

    for user_id in extra_user_ids:
        if user_id in allowed:
            wanted.add(user_id)

    for user_id in wanted:
        db.add(
            ProjectMember(
                project_id=project.id,
                user_id=user_id,
            )
        )


def _slugify_project_name(name: str) -> str:
    raw = (name or "").strip().lower()
    raw = unicodedata.normalize("NFKD", raw).encode(
        "ascii",
        "ignore",
    ).decode("ascii")

    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")

    return (slug or "project")[:80]


def _ensure_project_name_available(
    db: Session,
    team_id: int,
    project_name: str,
) -> None:
    wanted = _slugify_project_name(project_name)

    existing = db.scalars(
        select(Project.name).where(Project.team_id == team_id)
    ).all()

    if any(_slugify_project_name(name) == wanted for name in existing):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A project with this name already exists in this workspace. "
                "Choose a distinct project name."
            ),
        )


def _project_main_repo_path(project: Project) -> Path:
    if not project.workspace_path:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your project folder isn’t ready yet. Wait a few seconds and try again.",
        )

    repo_path = Path(project.workspace_path).expanduser() / "main"

    if not repo_path.exists() or not repo_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="We couldn’t find this project’s files on the server.",
        )

    return repo_path.resolve()


def _safe_repo_child(repo_path: Path, rel_path: str) -> Path:
    """Resolve a repo-relative file path; reject traversal and `.git` directory access."""
    raw = (rel_path or "").strip().replace("\\", "/").strip("/")
    if not raw or "\x00" in raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That file path isn’t allowed.",
        )

    parts: list[str] = []
    for segment in raw.split("/"):
        if not segment or segment == ".":
            continue
        if segment == "..":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That file path isn’t allowed.",
            )
        if segment == ".git":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That file path isn’t allowed.",
            )
        parts.append(segment)

    if not parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That file path isn’t allowed.",
        )

    clean = "/".join(parts)
    target = (repo_path / clean).resolve()

    if repo_path != target and repo_path not in target.parents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That file path isn’t allowed.",
        )

    return target


#########################################################################################################################
# END PROJECT HELPERS
#########################################################################################################################

#########################################################################################################################
# PROJECT ROUTES
#########################################################################################################################

@router.get("/team/projects", response_model=list[ProjectOut])
def list_team_projects(
    current_user: CurrentUser,
    db: Db,
) -> list[Project]:
    member = _ensure_membership(db, current_user)

    return list_projects_for_team_member(
        db,
        member,
        current_user.id,
    )


@router.post(
    "/team/projects",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
)
def create_team_project(
    body: ProjectCreateIn,
    current_user: CurrentUser,
    db: Db,
) -> Project:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can create projects",
        )

    n = int(
        db.scalar(
            select(func.count(Project.id)).where(
                Project.team_id == member.team_id
            )
        ) or 0
    )

    raw = (body.color or "").strip()

    color = (
        raw
        if len(raw) == 7 and raw.startswith("#")
        else _color_for_new_project_count(n)
    )

    desc = (body.description or "").strip() or None
    github_url = None
    source_type = "scratch"

    _ensure_project_name_available(db, member.team_id, body.name)

    project = Project(
        team_id=member.team_id,
        name=body.name.strip()[:200],
        description=desc,
        color=color,
        created_by_user_id=current_user.id,
        source_type=source_type,
        github_url=github_url,
        backend_notes=None,
        frontend_notes=None,
        database_notes=None,
        additional_notes=None,
        setup_status="creating",
        setup_step="Preparing your project space",
        setup_logs="",
        setup_error=None,
    )

    db.add(project)
    db.flush()

    _add_project_members_for_new(
        db,
        project,
        member.team_id,
        current_user,
        body.member_user_ids,
    )

    db.commit()
    db.refresh(project)

    create_empty_project_workspace(project.id)
    db.refresh(project)

    return project


@router.get("/team/projects/{project_id}", response_model=ProjectOut)
def get_team_project(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
) -> Project:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)

    _ensure_project_visible_to_member(db, project, member)

    return project


@router.get("/team/projects/{project_id}/setup-status", response_model=ProjectSetupStatusOut)
def get_project_setup_status(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
) -> ProjectSetupStatusOut:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)

    _ensure_project_visible_to_member(db, project, member)

    return ProjectSetupStatusOut(
        id=project.id,
        setup_status=project.setup_status,
        setup_step=project.setup_step,
        setup_logs=project.setup_logs,
        setup_error=project.setup_error,
        setup_completed_at=project.setup_completed_at,
        workspace_path=project.workspace_path,
    )


@router.get("/team/projects/{project_id}/repo/tree", response_model=list[RepoEntryOut])
def get_project_repo_tree(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
) -> list[RepoEntryOut]:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)

    _ensure_project_visible_to_member(db, project, member)

    if project.setup_status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your project is still being prepared. Try again in a few seconds.",
        )

    repo_path = _project_main_repo_path(project)
    entries: list[RepoEntryOut] = []

    for path in sorted(repo_path.rglob("*"), key=lambda p: str(p.relative_to(repo_path)).lower()):
        rel_parts = path.relative_to(repo_path).parts
        if any(part in REPO_EXCLUDED_DIRS for part in rel_parts):
            continue
        if len(entries) >= REPO_MAX_ENTRIES:
            break
        if path.is_dir():
            entries.append(
                RepoEntryOut(
                    path=str(path.relative_to(repo_path)),
                    name=path.name,
                    type="directory",
                    size=None,
                )
            )
        elif path.is_file():
            entries.append(
                RepoEntryOut(
                    path=str(path.relative_to(repo_path)),
                    name=path.name,
                    type="file",
                    size=path.stat().st_size,
                )
            )

    return entries


@router.get("/team/projects/{project_id}/repo/file", response_model=RepoFileOut)
def get_project_repo_file(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
    rel_path: str = Query(min_length=1, max_length=1_000),
) -> RepoFileOut:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)

    _ensure_project_visible_to_member(db, project, member)

    if project.setup_status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your project is still being prepared. Try again in a few seconds.",
        )

    repo_path = _project_main_repo_path(project)
    target = _safe_repo_child(repo_path, rel_path)

    if not target.exists() or not target.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    size = target.stat().st_size
    if size > REPO_MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File is too large to preview",
        )

    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File is not a readable text file",
        ) from exc

    return RepoFileOut(
        path=str(target.relative_to(repo_path)),
        name=target.name,
        content=content,
        size=size,
    )


def _iter_bytes_chunks(data: bytes, chunk_size: int = 65536):
    for i in range(0, len(data), chunk_size):
        yield data[i : i + chunk_size]


@router.get("/team/projects/{project_id}/repo/archive.zip")
def download_project_repo_zip(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
) -> StreamingResponse:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)

    _ensure_project_visible_to_member(db, project, member)

    if project.setup_status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your project is still being prepared. Try again in a few seconds.",
        )

    repo_path = _project_main_repo_path(project)
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        n_files = 0
        for path in sorted(
            repo_path.rglob("*"),
            key=lambda p: str(p.relative_to(repo_path)).lower(),
        ):
            rel_parts = path.relative_to(repo_path).parts
            if any(part in REPO_EXCLUDED_DIRS for part in rel_parts):
                continue
            if not path.is_file():
                continue
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if resolved != repo_path and repo_path not in resolved.parents:
                continue
            st = resolved.stat()
            if st.st_size > REPO_ZIP_MAX_FILE_BYTES:
                rel = str(resolved.relative_to(repo_path)).replace("\\", "/")
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f'File "{rel}" is too large to include in the ZIP export.',
                )
            if n_files >= REPO_ZIP_MAX_FILES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="This repository has too many files to export as a ZIP from the dashboard.",
                )
            arcname = str(resolved.relative_to(repo_path)).replace("\\", "/")
            zf.write(resolved, arcname=arcname)
            n_files += 1

    payload = buf.getvalue()
    download_name = f"{_slugify_project_name(project.name)}.zip"
    return StreamingResponse(
        _iter_bytes_chunks(payload),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Content-Length": str(len(payload)),
        },
    )


@router.patch("/team/projects/{project_id}", response_model=ProjectOut)
def patch_team_project(
    project_id: int,
    body: ProjectPatchIn,
    current_user: CurrentUser,
    db: Db,
) -> Project:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can update project settings",
        )

    project = _get_project_for_member(db, member, project_id)

    if body.name is not None:
        project.name = body.name.strip()[:200]

    if body.description is not None:
        project.description = body.description.strip() or None

    if body.color is not None:
        raw = body.color.strip()

        if len(raw) == 7 and raw.startswith("#"):
            project.color = raw

    db.commit()
    db.refresh(project)

    return project


@router.delete(
    "/team/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_team_project(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
) -> Response:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can delete projects",
        )

    project = _get_project_for_member(db, member, project_id)

    db.delete(project)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/team/projects/{project_id}/members",
    response_model=list[ProjectMemberOut],
)
def list_project_members(
    project_id: int,
    current_user: CurrentUser,
    db: Db,
) -> list[ProjectMemberOut]:
    member = _ensure_membership(db, current_user)
    project = _get_project_for_member(db, member, project_id)

    _ensure_project_visible_to_member(db, project, member)

    rows = db.execute(
        select(User, TeamMember)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .join(
            TeamMember,
            (TeamMember.user_id == User.id)
            & (TeamMember.team_id == member.team_id),
        )
        .where(ProjectMember.project_id == project.id)
        .order_by(User.full_name.asc())
    ).all()

    return [
        ProjectMemberOut(
            user_id=user.id,
            full_name=user.full_name,
            email=user.email,
            role=team_member.role,  # type: ignore[arg-type]
        )
        for user, team_member in rows
    ]


@router.post(
    "/team/projects/{project_id}/members",
    response_model=ProjectMemberOut,
    status_code=status.HTTP_201_CREATED,
)
def add_project_member(
    project_id: int,
    body: ProjectMemberAddIn,
    current_user: CurrentUser,
    db: Db,
) -> ProjectMemberOut:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can add people to a project",
        )

    project = _get_project_for_member(db, member, project_id)

    row = db.execute(
        select(TeamMember, User)
        .join(User, User.id == TeamMember.user_id)
        .where(
            TeamMember.team_id == member.team_id,
            TeamMember.user_id == body.user_id,
        )
    ).first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not a member of this workspace",
        )

    team_member, user = row[0], row[1]

    existing = db.scalar(
        select(ProjectMember.id).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == body.user_id,
        )
    )

    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already on this project",
        )

    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=body.user_id,
        )
    )

    db.commit()

    return ProjectMemberOut(
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=team_member.role,  # type: ignore[arg-type]
    )


@router.delete(
    "/team/projects/{project_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_project_member(
    project_id: int,
    user_id: int,
    current_user: CurrentUser,
    db: Db,
) -> Response:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can remove people from a project",
        )

    project = _get_project_for_member(db, member, project_id)

    n = int(
        db.scalar(
            select(func.count(ProjectMember.id)).where(
                ProjectMember.project_id == project.id
            )
        ) or 0
    )

    if n <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove the last person from a project",
        )

    project_member = db.scalars(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user_id,
        )
    ).first()

    if project_member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not on this project",
        )

    db.delete(project_member)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


#########################################################################################################################
# END PROJECT ROUTES
#########################################################################################################################
