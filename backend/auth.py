#########################################################################################################################
# IMPORTS
#########################################################################################################################

from __future__ import annotations
import html
import secrets
import smtplib
import ssl
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Annotated, Optional
import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

#########################################################################################################################
# END IMPORTS
#########################################################################################################################

#########################################################################################################################
# IMPORTS FROM OTHER FILES
#########################################################################################################################

from main import (
    AuthChallenge,
    AuthOut,
    AuthResponse,
    Db,
    Invite,
    InviteOpenIn,
    InviteOpenOut,
    LoginIn,
    MeOut,
    SessionToken,
    SignupIn,
    Team,
    TeamMember,
    User,
    VerifyCodeIn,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USER,
    _workspace_name_from_profile,
)

router = APIRouter(tags=["auth"])

#########################################################################################################################
# IMPORTS FROM OTHER FILES
#########################################################################################################################

#########################################################################################################################
# VERIFICATION EMAIL (SMTP)
#########################################################################################################################

CHALLENGE_SIGNUP = "signup"
CHALLENGE_LOGIN = "login"

VERIFICATION_CODE_TTL = timedelta(minutes=15)

_VERIFICATION_BRAND = "Jinoe"


def _verification_code_email_html(
    *,
    eyebrow: str,
    title: str,
    intro: str,
    code: str,
    foot: str,
) -> str:
    """Branded OTP email: same surface, ink, and chartreuse accents as product + team invite mail."""

    code_escaped = html.escape(code)
    eyebrow_escaped = html.escape(eyebrow)
    title_escaped = html.escape(title)
    foot_escaped = html.escape(foot)
    brand = html.escape(_VERIFICATION_BRAND)

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
    {eyebrow_escaped}
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
    {title_escaped}
</h1>

<div style="
    margin:0 0 22px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:15px;
    line-height:1.6;
    color:#2f312f;
">
    {intro}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-radius:10px;overflow:hidden;border:1px solid #deded8;">
<tr>
<td width="4" bgcolor="#dfff00" style="width:4px;background-color:#dfff00;font-size:0;line-height:0;">&nbsp;</td>
<td bgcolor="#f6f6f2" style="background-color:#f6f6f2;padding:20px 22px;text-align:center;">
<span style="
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:28px;
    font-weight:800;
    letter-spacing:0.32em;
    color:#0b0a08;
">{code_escaped}</span>
</td>
</tr>
</table>

<p style="
    margin:0;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:13px;
    line-height:1.55;
    color:#767a74;
">
    {foot_escaped}
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


def _send_verification_code_email(
    *,
    to_addr: str,
    code: str,
    kind: str,
) -> None:
    """
    Send a verification email using SMTP.
    """

    host = SMTP_HOST
    port = SMTP_PORT

    user = SMTP_USER
    password = SMTP_PASSWORD

    from_addr = SMTP_FROM

    if kind == CHALLENGE_SIGNUP:
        subject = f"Verify your email · {_VERIFICATION_BRAND}"

        text = (
            f"{_VERIFICATION_BRAND} · email verification\n\n"
            f"Your code: {code}\n\n"
            "Enter it on the signup page to finish creating your account. "
            "This code expires in 15 minutes.\n\n"
            "If you did not start signup, you can ignore this email.\n"
        )

        intro = (
            "<p style=\"margin:0 0 12px;\">"
            "Enter this code on the <strong style=\"color:#0b0a08;\">signup</strong> page "
            "to finish creating your account."
            "</p>"
            "<p style=\"margin:0;\">"
            "It expires in <strong style=\"color:#0b0a08;\">15 minutes</strong>."
            "</p>"
        )

        html_body = _verification_code_email_html(
            eyebrow="Email verification",
            title="Here's your code",
            intro=intro,
            code=code,
            foot="If you did not request this, you can safely ignore this email.",
        )

    else:
        subject = f"Your sign-in code · {_VERIFICATION_BRAND}"

        text = (
            f"{_VERIFICATION_BRAND} · sign-in verification\n\n"
            f"Your code: {code}\n\n"
            "Enter it on the sign-in page to continue. "
            "This code expires in 15 minutes.\n\n"
            "If you did not try to sign in, you can ignore this email.\n"
        )

        intro = (
            "<p style=\"margin:0 0 12px;\">"
            "Enter this code on the <strong style=\"color:#0b0a08;\">sign-in</strong> page "
            "to finish signing in."
            "</p>"
            "<p style=\"margin:0;\">"
            "It expires in <strong style=\"color:#0b0a08;\">15 minutes</strong>."
            "</p>"
        )

        html_body = _verification_code_email_html(
            eyebrow="Sign-in verification",
            title="Your one-time code",
            intro=intro,
            code=code,
            foot="If you did not try to sign in, you can safely ignore this email. Your account stays protected.",
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


def _create_verification_challenge(
    db: Session,
    user: User,
    kind: str,
) -> str:
    """
    Create a verification challenge and email the code.
    """

    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge_id = str(uuid.uuid4())

    db.execute(
        delete(AuthChallenge).where(
            AuthChallenge.user_id == user.id,
            AuthChallenge.kind == kind,
        )
    )

    db.add(
        AuthChallenge(
            id=challenge_id,
            user_id=user.id,
            code_hash=_hash_password(code),
            kind=kind,
            expires_at=datetime.now(timezone.utc) + VERIFICATION_CODE_TTL,
        )
    )

    db.commit()

    try:
        _send_verification_code_email(
            to_addr=user.email,
            code=code,
            kind=kind,
        )

    except Exception as exc:  # noqa: BLE001
        warnings.warn(
            f"Could not send verification email: {exc}",
            stacklevel=1,
        )

    return challenge_id


def _auth_to_response(auth: AuthOut) -> AuthResponse:
    """
    Convert AuthOut into AuthResponse.
    """

    return AuthResponse(
        verification_required=False,
        access_token=auth.access_token,
        user=auth.user,
        team=auth.team,
        role=auth.role,
    )


def _hash_password(plain: str) -> str:
    """
    Hash a password using bcrypt.
    """

    return bcrypt.hashpw(
        plain.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a password against a bcrypt hash.
    """

    return bcrypt.checkpw(
        plain.encode("utf-8"),
        hashed.encode("utf-8"),
    )


def _issue_token(db: Session, user: User) -> str:
    """
    Create and persist a session token.
    """

    token = secrets.token_urlsafe(32)

    db.add(
        SessionToken(
            token=token,
            user_id=user.id,
        )
    )

    db.commit()

    return token


def _membership(
    db: Session,
    user_id: int,
) -> TeamMember | None:
    """
    Return the user's team membership.
    """

    return db.scalars(
        select(TeamMember).where(
            TeamMember.user_id == user_id
        )
    ).first()


def _team_for_member(
    db: Session,
    member: TeamMember,
) -> Team:
    """
    Return the team for a team member.
    """

    team = db.get(Team, member.team_id)

    if not team:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Team is missing",
        )

    return team


def _ensure_membership(
    db: Session,
    user: User,
) -> TeamMember:
    """
    Ensure the user belongs to a team.
    """

    member = _membership(db, user.id)

    if member:
        return member

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not a member of a team",
    )


def _auth_user(
    db: Db,
    authorization: Annotated[Optional[str], Header()] = None,
) -> User:
    """
    Authenticate a user from a bearer token.
    """

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token",
        )

    token = authorization.split(" ", 1)[1].strip()

    session_token = db.get(SessionToken, token)

    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
        )

    user = db.get(User, session_token.user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
        )

    _ensure_membership(db, user)

    return user


CurrentUser = Annotated[User, Depends(_auth_user)]


def _auth_payload(
    db: Session,
    user: User,
    access_token: str,
) -> AuthOut:
    """
    Build the authentication response payload.
    """

    member = _ensure_membership(db, user)
    team = _team_for_member(db, member)

    return AuthOut(
        access_token=access_token,
        user=user,
        team=team,
        role=member.role,
    )  # type: ignore[arg-type]


#########################################################################################################################
# END VERIFICATION EMAIL (SMTP)
#########################################################################################################################

#########################################################################################################################
# AUTH API ROUTES
#########################################################################################################################

@router.post("/auth/invite/open", response_model=InviteOpenOut)
def auth_invite_open(
    body: InviteOpenIn,
    db: Db,
) -> InviteOpenOut:
    """
    Mark an invite as opened.
    """

    token = body.token.strip()

    invite = db.scalars(
        select(Invite).where(Invite.token == token)
    ).first()

    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This invite link is not valid.",
        )

    if invite.cancelled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "This invite was withdrawn by the workspace owner. "
                "They can send you a new invite if you still need access."
            ),
        )

    if invite.accepted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This invite has already been used.",
        )

    if invite.opened_at is None:
        invite.opened_at = datetime.now(timezone.utc)
        db.commit()

    return InviteOpenOut(email=invite.email.lower())


@router.post(
    "/auth/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
def auth_signup(
    body: SignupIn,
    db: Db,
) -> AuthResponse:
    """
    Create a user account.

    A signup with an invite joins the invite's workspace as a collaborator.
    A signup without an invite starts a new workspace and makes the user its
    owner. This keeps owner onboarding independent for each B2B customer.
    """

    email = body.email.lower().strip()
    company = (body.company_name or "").strip() or None
    invite_token = (body.invite_token or "").strip()

    existing_user = db.scalars(
        select(User).where(User.email == email)
    ).first()

    if existing_user:
        # Owner signup persists the user + workspace before the email code step; closing
        # the page leaves email_verified_at unset. Login with the same password issues a
        # fresh code and completes verification.
        if existing_user.email_verified_at is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Signup for this email was already started but isn’t finished yet. "
                    "Use Sign in with the same email and password—we’ll send a new verification code."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    invite: Invite | None = None

    if invite_token:
        invite = db.scalars(
            select(Invite).where(Invite.token == invite_token)
        ).first()

        if not invite or invite.email != email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You need a valid invite to create an account",
            )

        if invite.cancelled_at is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This invite was withdrawn by the workspace owner. "
                    "Ask them to send a new invite if you should still join."
                ),
            )

        if invite.accepted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This invite has already been used.",
            )

    is_owner_signup = invite is None

    user = User(
        full_name=body.full_name.strip(),
        company_name=company,
        email=email,
        password_hash=_hash_password(body.password),
        email_verified_at=(
            None
            if is_owner_signup
            else datetime.now(timezone.utc)
        ),
    )

    db.add(user)
    db.flush()

    if is_owner_signup:
        team = Team(
            name=_workspace_name_from_profile(
                full_name=body.full_name.strip(),
                company_name=company,
            )
        )

        db.add(team)
        db.flush()

        db.add(
            TeamMember(
                team_id=team.id,
                user_id=user.id,
                role="owner",
            )
        )

    else:
        assert invite is not None

        db.add(
            TeamMember(
                team_id=invite.team_id,
                user_id=user.id,
                role=invite.role,
            )
        )

        invite.accepted_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(user)

    if is_owner_signup:
        challenge_id = _create_verification_challenge(
            db,
            user,
            CHALLENGE_SIGNUP,
        )

        return AuthResponse(
            verification_required=True,
            challenge_id=challenge_id,
        )

    token = _issue_token(db, user)

    return _auth_to_response(
        _auth_payload(db, user, token)
    )


@router.post("/auth/login", response_model=AuthResponse)
def auth_login(
    body: LoginIn,
    db: Db,
) -> AuthResponse:
    """
    Authenticate a user and begin verification.
    """

    email = body.email.lower().strip()

    user = db.scalars(
        select(User).where(User.email == email)
    ).first()

    if not user or not _verify_password(
        body.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # No team row (e.g. removed from workspace): same response as bad password so we do not
    # leak account state or send a verification email they cannot complete.
    if _membership(db, user.id) is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    challenge_id = _create_verification_challenge(
        db,
        user,
        CHALLENGE_LOGIN,
    )

    return AuthResponse(
        verification_required=True,
        challenge_id=challenge_id,
    )


@router.post("/auth/verify-code", response_model=AuthOut)
def auth_verify_code(
    body: VerifyCodeIn,
    db: Db,
) -> AuthOut:
    """
    Verify a 6 digit code and issue an access token.
    """

    digits = "".join(
        character
        for character in body.code
        if character.isdigit()
    )

    if len(digits) != 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter the 6-digit code from your email",
        )

    challenge = db.get(
        AuthChallenge,
        body.challenge_id.strip(),
    )

    if (
        not challenge
        or challenge.expires_at < datetime.now(timezone.utc)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired code",
        )

    if not _verify_password(digits, challenge.code_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired code",
        )

    user = db.get(User, challenge.user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired code",
        )

    challenge_kind = challenge.kind

    # Removed from team after a code was issued: do not reveal workspace status; same as bad code.
    if _membership(db, user.id) is None:
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired code",
        )

    db.delete(challenge)

    if (
        challenge_kind == CHALLENGE_SIGNUP
        or user.email_verified_at is None
    ):
        user.email_verified_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(user)

    access_token = _issue_token(db, user)

    return _auth_payload(
        db,
        user,
        access_token,
    )


@router.get("/auth/me", response_model=MeOut)
def auth_me(
    current_user: CurrentUser,
    db: Db,
) -> MeOut:
    """
    Return the authenticated user and workspace details.
    """

    member = _ensure_membership(db, current_user)
    team = _team_for_member(db, member)

    return MeOut(
        user=current_user,  # type: ignore[arg-type]
        team=team,
        role=member.role,  # type: ignore[arg-type]
        last_selected_project_id=member.last_selected_project_id,
    )


@router.post("/auth/logout")
def auth_logout(
    db: Db,
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict[str, str]:
    """
    Invalidate the current session token.
    """

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

        session_token = db.get(SessionToken, token)

        if session_token:
            db.delete(session_token)
            db.commit()

    return {"status": "ok"}


#########################################################################################################################
# END AUTH API ROUTES
#########################################################################################################################
