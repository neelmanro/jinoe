#########################################################################################################################
# IMPORTS
#########################################################################################################################

from __future__ import annotations
import html
import secrets
import smtplib
import ssl
import warnings
from datetime import datetime, timezone
from email.message import EmailMessage
import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session
from starlette.responses import Response

#########################################################################################################################
# END IMPORTS
#########################################################################################################################

#########################################################################################################################
# IMPORTS FROM OTHER FILES
#########################################################################################################################

from auth import CurrentUser, _ensure_membership, _membership, _team_for_member
from project import list_projects_for_team_member

from main import (
    Db,
    FRONTEND_URL,
    Invite,
    InviteIn,
    InviteOut,
    MemberOut,
    MeOut,
    OPENAI_API_KEY,
    OPENAI_TRANSCRIBE_MODEL,
    OPENAI_TRANSCRIBE_URL,
    Project,
    ProjectMember,
    SessionToken,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USER,
    Task,
    TeamMember,
    TranscribeOut,
    User,
    WorkspacePrefsIn,
    WorkspaceUpdateIn,
)

#########################################################################################################################
# END IMPORTS FROM OTHER FILES
#########################################################################################################################

#########################################################################################################################
# TEAMS ROUTES
#########################################################################################################################

router = APIRouter(tags=["team"])

_INVITE_PRODUCT_BRAND = "Jinoe"


def _team_invite_email_html(
    *,
    greet: str,
    inviter_name: str,
    team_name: str,
    invite_url: str,
) -> str:
    """
    Branded HTML for workspace invites — mirrors app tokens (white canvas, ink, chartreuse CTA).
    Table layout for broad email client support.
    """

    g = html.escape(greet)
    inv = html.escape(inviter_name)
    team = html.escape(team_name)
    url = html.escape(invite_url)
    brand = html.escape(_INVITE_PRODUCT_BRAND)

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#f6f6f2;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#f6f6f2;padding:40px 16px;">
<tr>
<td align="center">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr>
<td style="padding:0 0 20px;text-align:left;">
    <span style="
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
        font-size:13px;
        font-weight:800;
        letter-spacing:-0.02em;
        color:#0b0a08;
    ">{brand}</span>
</td>
</tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="
    max-width:520px;
    background-color:#ffffff;
    border-radius:12px;
    border:1px solid #deded8;
    box-shadow:0 8px 24px rgba(11,10,8,0.07),0 1px 1px rgba(11,10,8,0.05);
">
<tr>
<td style="padding:36px 32px 32px;">

<p style="
    margin:0 0 10px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:11px;
    font-weight:700;
    color:#666a66;
    letter-spacing:0.14em;
    text-transform:uppercase;
">
    Workspace invite
</p>

<h1 style="
    margin:0 0 14px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:22px;
    font-weight:800;
    line-height:1.25;
    letter-spacing:-0.02em;
    color:#0b0a08;
">
    Join <span style="white-space:nowrap;">“{team}”</span>
</h1>

<p style="
    margin:0 0 22px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:15px;
    line-height:1.6;
    color:#2f312f;
">
    Hi {g},<br><br>
    <strong style="color:#0b0a08;">{inv}</strong> invited you to collaborate on this workspace in {brand}.
    Accept below to create your account or sign in and jump in.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
<tr>
<td style="border-radius:10px;background-color:#dfff00;">
    <a href="{url}" style="
        display:inline-block;
        padding:14px 28px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
        font-size:15px;
        font-weight:700;
        letter-spacing:-0.01em;
        color:#0b0a08;
        text-decoration:none;
        border-radius:10px;
    ">Accept invitation</a>
</td>
</tr>
</table>

<p style="
    margin:0 0 8px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:13px;
    line-height:1.55;
    color:#666a66;
">
    Button not working? Paste this link into your browser:<br>
    <a href="{url}" style="color:#2f312f;word-break:break-all;">{url}</a>
</p>

<p style="
    margin:24px 0 0;
    padding-top:22px;
    border-top:1px solid #eeeeea;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:13px;
    line-height:1.55;
    color:#767a74;
">
    If you were not expecting this email, you can ignore it; no account will be created without your action.
</p>

</td>
</tr>
</table>

<p style="
    margin:20px 0 0;
    max-width:520px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:12px;
    line-height:1.5;
    color:#8a8e86;
    text-align:center;
">
    Sent by {brand} · Enterprise dev workspace
</p>

</td>
</tr>
</table>

</body>
</html>
"""


def _send_team_invite_email(
    *,
    to_addr: str,
    invite_url: str,
    team_name: str,
    inviter_name: str,
    invited_name: str | None,
) -> None:
    """Send a workspace invite email."""

    host = SMTP_HOST
    port = SMTP_PORT
    user = SMTP_USER
    password = SMTP_PASSWORD
    from_addr = SMTP_FROM

    greet = (invited_name or "").strip() or "there"

    subject = f"You're invited to “{team_name}” · {_INVITE_PRODUCT_BRAND}"

    text = (
        f"Hi {greet},\n\n"
        f"{inviter_name} invited you to collaborate on the workspace “{team_name}” in {_INVITE_PRODUCT_BRAND}.\n\n"
        f"Accept your invitation:\n{invite_url}\n\n"
        "If you were not expecting this message, you can ignore it.\n"
    )

    html_body = _team_invite_email_html(
        greet=greet,
        inviter_name=inviter_name,
        team_name=team_name,
        invite_url=invite_url,
    )

    msg = EmailMessage()

    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr

    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()

    with smtplib.SMTP(host, port, timeout=30) as server:
        server.starttls(context=context)
        server.login(user, password)
        server.send_message(msg)


def _invite_out(invite: Invite) -> InviteOut:
    return InviteOut(
        id=invite.id,
        email=invite.email,
        invited_name=invite.invited_name,
        role=invite.role,
        token=invite.token,
        accepted_at=invite.accepted_at,
        opened_at=invite.opened_at,
        created_at=invite.created_at,
        invite_url=f"{FRONTEND_URL}/signup?invite={invite.token}",
    )


def _remove_team_member_from_workspace(
    db: Session,
    team_id: int,
    target_user_id: int,
) -> None:
    """Remove a collaborator from the workspace."""

    team_member = db.scalars(
        select(TeamMember).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == target_user_id,
        )
    ).first()

    if not team_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    if team_member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove a workspace owner",
        )

    project_ids = list(
        db.scalars(
            select(Project.id).where(Project.team_id == team_id)
        ).all()
    )

    if project_ids:
        db.execute(
            delete(ProjectMember).where(
                ProjectMember.user_id == target_user_id,
                ProjectMember.project_id.in_(project_ids),
            )
        )

        db.execute(
            update(Task)
            .where(
                Task.project_id.in_(project_ids),
                Task.assignee_user_id == target_user_id,
            )
            .values(assignee_user_id=None)
        )

    db.execute(
        delete(SessionToken).where(
            SessionToken.user_id == target_user_id
        )
    )

    db.delete(team_member)
    db.commit()


@router.put("/team/workspace/preferences", response_model=MeOut)
def put_workspace_preferences(
    body: WorkspacePrefsIn,
    current_user: CurrentUser,
    db: Db,
) -> MeOut:
    member = _ensure_membership(db, current_user)
    team = _team_for_member(db, member)

    project_id = body.last_selected_project_id

    if project_id is not None:
        visible_projects = list_projects_for_team_member(
            db,
            member,
            current_user.id,
        )

        allowed_project_ids = {project.id for project in visible_projects}

        if project_id not in allowed_project_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Project is not available for this account",
            )

    member.last_selected_project_id = project_id

    db.commit()
    db.refresh(member)

    return MeOut(
        user=current_user,  # type: ignore[arg-type]
        team=team,
        role=member.role,  # type: ignore[arg-type]
        last_selected_project_id=member.last_selected_project_id,
    )


@router.patch("/team/workspace", response_model=MeOut)
def patch_workspace(
    body: WorkspaceUpdateIn,
    current_user: CurrentUser,
    db: Db,
) -> MeOut:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only workspace owners can rename the workspace",
        )

    team = _team_for_member(db, member)
    name = body.name.strip()

    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workspace name cannot be empty",
        )

    team.name = name

    db.commit()
    db.refresh(team)

    return MeOut(
        user=current_user,  # type: ignore[arg-type]
        team=team,
        role=member.role,  # type: ignore[arg-type]
        last_selected_project_id=member.last_selected_project_id,
    )


@router.get("/team/members", response_model=list[MemberOut])
def team_members(
    current_user: CurrentUser,
    db: Db,
) -> list[MemberOut]:
    member = _ensure_membership(db, current_user)

    rows = db.execute(
        select(User, TeamMember)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == member.team_id)
        .order_by(TeamMember.role.desc(), User.full_name.asc())
    ).all()

    return [
        MemberOut(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            company_name=user.company_name,
            role=team_member.role,  # type: ignore[arg-type]
            joined_at=team_member.created_at,
        )
        for user, team_member in rows
    ]


@router.delete(
    "/team/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def remove_team_member(
    user_id: int,
    current_user: CurrentUser,
    db: Db,
) -> Response:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners can remove members",
        )

    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove yourself from the workspace",
        )

    _remove_team_member_from_workspace(db, member.team_id, user_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/team/invites", response_model=list[InviteOut])
def team_invites(
    current_user: CurrentUser,
    db: Db,
) -> list[InviteOut]:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners can view invites",
        )

    invites = db.scalars(
        select(Invite)
        .where(
            Invite.team_id == member.team_id,
            Invite.cancelled_at.is_(None),
        )
        .order_by(Invite.created_at.desc())
    ).all()

    return [_invite_out(invite) for invite in invites]


@router.post(
    "/team/invites",
    response_model=InviteOut,
    status_code=status.HTTP_201_CREATED,
)
def create_team_invite(
    body: InviteIn,
    current_user: CurrentUser,
    db: Db,
) -> InviteOut:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners can invite teammates",
        )

    email = body.email.lower().strip()

    existing_user = db.scalars(
        select(User).where(User.email == email)
    ).first()

    if existing_user and _membership(db, existing_user.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user is already on a team",
        )

    pending_same = db.scalars(
        select(Invite).where(
            Invite.team_id == member.team_id,
            Invite.email == email,
            Invite.accepted_at.is_(None),
            Invite.cancelled_at.is_(None),
        )
    ).first()

    if pending_same:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An invite is already pending for this email",
        )

    invite = Invite(
        team_id=member.team_id,
        invited_by_user_id=current_user.id,
        email=email,
        invited_name=None,
        role=body.role,
        token=secrets.token_urlsafe(24),
    )

    db.add(invite)
    db.commit()
    db.refresh(invite)

    out = _invite_out(invite)
    team = _team_for_member(db, member)
    inviter = db.get(User, current_user.id)

    if inviter:
        try:
            _send_team_invite_email(
                to_addr=email,
                invite_url=out.invite_url,
                team_name=team.name,
                inviter_name=inviter.full_name,
                invited_name=None,
            )

        except Exception as exc:  # noqa: BLE001
            warnings.warn(
                f"Could not send invite email: {exc}",
                stacklevel=1,
            )

    return out


@router.delete(
    "/team/invites/{invite_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_team_invite(
    invite_id: int,
    current_user: CurrentUser,
    db: Db,
) -> Response:
    member = _ensure_membership(db, current_user)

    if member.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners can cancel invites",
        )

    invite = db.get(Invite, invite_id)

    if not invite or invite.team_id != member.team_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found",
        )

    if invite.accepted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel an invite that was already accepted",
        )

    if invite.cancelled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite was already withdrawn",
        )

    invite.cancelled_at = datetime.now(timezone.utc)

    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/team/transcribe-audio", response_model=TranscribeOut)
async def transcribe_team_audio(
    current_user: CurrentUser,
    db: Db,
    file: UploadFile = File(...),
) -> TranscribeOut:
    """Transcribe team audio through the OpenAI Audio API."""

    _ensure_membership(db, current_user)

    key = OPENAI_API_KEY
    content = await file.read()

    if len(content) < 80:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recording too short or empty",
        )

    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audio file too large",
        )

    filename = file.filename or "recording.webm"
    mime = file.content_type or "audio/webm"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                OPENAI_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {key}"},
                files={"file": (filename, content, mime)},
                data={
                    "model": OPENAI_TRANSCRIBE_MODEL,
                    "response_format": "json",
                },
            )

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach transcription service: {exc}",
        ) from exc

    if response.status_code != 200:
        detail = (
            response.text[:800]
            if response.text
            else response.reason_phrase
        ) or "unknown error"

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Transcription failed: {detail}",
        )

    try:
        payload = response.json()

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid response from transcription service",
        )

    text = (payload.get("text") or "").strip()

    return TranscribeOut(text=text)


#########################################################################################################################
# END TEAMS ROUTES
#########################################################################################################################