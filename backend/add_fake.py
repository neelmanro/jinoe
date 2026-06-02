#!/usr/bin/env python3
"""
Add fake collaborators to the workspace owner's team (local/dev).

Creates full User rows + TeamMember rows — same end state as if each person
completed an invite signup (verified email, company name, password hash).

Usage (from repo root or backend/):

  cd backend
  python3 add_fake.py you@company.com

Optional:

  python3 add_fake.py --owner-email you@company.com --count 20 --company Jinoe
  FAKE_MEMBER_PASSWORD=Secret123! python3 add_fake.py you@company.com
  FAKE_EMAIL_DOMAIN=contractors.acme.com python3 add_fake.py you@company.com

If you omit FAKE_EMAIL_DOMAIN and --email-domain, addresses are derived from the
owner email (Gmail-style plus addressing into the owner's inbox, or first.last@team.<domain>).

Requires backend/.env (copy from .env.example) with DATABASE_URL and related vars.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent

# Load env before importing main (DATABASE_URL, SQLALCHEMY_ECHO, etc.)
from dotenv import load_dotenv

load_dotenv(BACKEND_DIR / ".env")
os.environ.setdefault("SQLALCHEMY_ECHO", "false")

sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy.orm import Session  # noqa: E402

import main  # noqa: E402  — registers models + engine
from auth import _hash_password  # noqa: E402
from sqlalchemy import select  # noqa: E402


FAKE_PEOPLE = [
    "Maya Patel",
    "Ethan Brooks",
    "Ava Thompson",
    "Noah Kim",
    "Sophia Martinez",
    "Liam Chen",
    "Isabella Nguyen",
    "Lucas Rivera",
    "Mia Johnson",
    "Oliver Singh",
    "Amelia Davis",
    "Elijah Wilson",
    "Harper Brown",
    "James Anderson",
    "Charlotte Garcia",
    "Benjamin Lee",
    "Evelyn Clark",
    "Henry Walker",
    "Aria Shah",
    "Daniel Wright",
    "Sofia Rodriguez",
    "Leo Morgan",
    "Nora Campbell",
    "Samuel Torres",
    "Grace Mitchell",
    "Mateo Flores",
    "Ella Carter",
    "Jack Murphy",
    "Zoe Adams",
    "Owen Hughes",
]


def _email_slug(name: str) -> str:
    return ".".join(part.lower() for part in name.split() if part)


def _fake_member_email(*, owner_email: str, name_slug: str, cycle: int, domain_override: str | None) -> str:
    """
    Build a unique, realistic-looking address.

    - If ``domain_override`` is set: ``{slug}@{domain_override}`` (slug includes a numeric suffix when cycle > 0).
    - Consumer mail hosts: plus-address into the owner's mailbox so mail is deliverable in dev.
    - Custom domains: ``{slug}@team.<domain>`` so it reads like a company roster without touching the owner's inbox.
    """
    suffix = "" if cycle == 0 else str(cycle + 1)
    slug = f"{name_slug}{suffix}".lower()
    d = (domain_override or "").strip().lower()
    if d:
        return f"{slug}@{d}"

    o = owner_email.strip().lower()
    if "@" not in o:
        return f"{slug}@example.com"
    local, _, host = o.partition("@")
    local = local.strip()
    host = host.strip()
    if not local or not host:
        return f"{slug}@example.com"

    # Major hosts where plus-addressing is standard (delivers to the owner's real inbox).
    consumer = {
        "gmail.com",
        "googlemail.com",
        "hotmail.com",
        "outlook.com",
        "live.com",
        "msn.com",
        "icloud.com",
        "me.com",
        "yahoo.com",
        "yahoo.co.uk",
        "proton.me",
        "protonmail.com",
    }
    tag = slug.replace("@", "").replace("+", "")[:50]
    if host in consumer:
        return f"{local}+collab.{tag}@{host}"
    return f"{slug}@team.{host}"


def _find_owner_team(db: Session, owner_email: str) -> tuple[main.User, int]:
    email = owner_email.lower().strip()
    if not email:
        raise SystemExit("Set OWNER_EMAIL or pass --owner-email with the workspace owner's email.")
    owner = db.scalars(select(main.User).where(main.User.email == email)).first()
    if not owner:
        raise SystemExit(f"No user found with email {email!r}.")
    tm = db.scalars(select(main.TeamMember).where(main.TeamMember.user_id == owner.id)).first()
    if not tm:
        raise SystemExit(f"User {email} has no team membership.")
    return owner, tm.team_id


def run() -> None:
    parser = argparse.ArgumentParser(description="Add fake team members to the workspace owner's team.")
    parser.add_argument(
        "owner_email_positional",
        nargs="?",
        help="Workspace owner email. Same as --owner-email, but faster to type.",
    )
    parser.add_argument(
        "--owner-email",
        default=(os.environ.get("OWNER_EMAIL") or "").strip(),
        help="Workspace owner email (default: OWNER_EMAIL env, or positional email)",
    )
    parser.add_argument("--count", type=int, default=20, help="How many collaborators to add (default 20)")
    parser.add_argument("--company", default="Jinoe", help="company_name on each user")
    parser.add_argument(
        "--password",
        default=os.environ.get("FAKE_MEMBER_PASSWORD", "FakePass123!"),
        help="Shared login password for fake accounts (default: FAKE_MEMBER_PASSWORD or FakePass123!)",
    )
    parser.add_argument(
        "--email-domain",
        default=os.environ.get("FAKE_EMAIL_DOMAIN", "").strip() or None,
        metavar="DOMAIN",
        help="Force first.last@DOMAIN for everyone. If omitted, derive from the owner's email (see script docstring).",
    )
    args = parser.parse_args()
    owner_email = (args.owner_email_positional or args.owner_email or "").strip()
    domain_override = args.email_domain

    db = main.SessionLocal()
    created = 0
    skipped = 0
    try:
        owner, team_id = _find_owner_team(db, owner_email)
        now = datetime.now(timezone.utc)
        pwd_hash = _hash_password(args.password)

        for i in range(1, args.count + 1):
            base_name = FAKE_PEOPLE[(i - 1) % len(FAKE_PEOPLE)]
            cycle = (i - 1) // len(FAKE_PEOPLE)
            full_name = base_name if cycle == 0 else f"{base_name} {cycle + 1}"
            email_prefix = _email_slug(base_name)
            email = _fake_member_email(
                owner_email=owner.email,
                name_slug=email_prefix,
                cycle=cycle,
                domain_override=domain_override,
            )
            if db.scalars(select(main.User).where(main.User.email == email)).first():
                print(f"[skip] already exists: {email}")
                skipped += 1
                continue

            user = main.User(
                full_name=full_name,
                company_name=args.company.strip() or None,
                email=email,
                password_hash=pwd_hash,
                email_verified_at=now,
            )
            db.add(user)
            db.flush()
            db.add(
                main.TeamMember(
                    team_id=team_id,
                    user_id=user.id,
                    role="collaborator",
                )
            )
            created += 1
            print(f"[ok] {full_name} <{email}>")

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print()
    print(f"Done. Added {created} member(s), skipped {skipped}. Owner team id tied to {owner_email!r}.")
    print(f"Login password for all new accounts: {args.password!r}")
    print(f"Company name set to: {args.company!r}")
    if domain_override:
        print(f"Email domain forced to: {domain_override!r}")
    else:
        print("Emails derived from the owner's address (plus collab.* on consumer hosts, or @team.<domain> otherwise).")


if __name__ == "__main__":
    run()
