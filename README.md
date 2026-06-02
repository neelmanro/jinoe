# Jinoe

Jinoe is a full-stack AI product workspace for planning, building, reviewing, and shipping software changes from one team dashboard. It combines project onboarding, task assignment, in-browser code workspaces, AI-assisted implementation, chat, repository browsing, and owner review flows into a single application.

This repository is structured as a recruiter-friendly, open-source snapshot of the product. Local secrets are intentionally excluded. Start from the checked-in `.env.example` files when running the app.

## What It Does

- Creates team workspaces with email verification, session auth, roles, and invite links.
- Organizes each team's work into projects with explicit project membership.
- Creates isolated project repositories on disk and guides owners through first-time setup.
- Opens browser-based VS Code sessions backed by Docker and `code-server`.
- Tracks tasks across `todo`, `doing`, `review`, and `shipped` states.
- Lets owners assign tasks to people or to Jinoe AI.
- Runs AI task work in an isolated worktree, streams progress, and submits changes for review.
- Shows submitted diffs and changed files before an owner approves or declines a merge.
- Provides project chat with WebSocket updates, replies, reactions, read receipts, and voice transcription.
- Includes a repository browser for tree navigation, file preview, copy, refresh, and zip download.

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS.
- Backend: FastAPI, SQLAlchemy, Pydantic, PostgreSQL via `psycopg`.
- Realtime: FastAPI WebSockets for project chat and Server-Sent Events for assistant streams.
- AI integrations: OpenAI-compatible chat endpoints, OpenAI audio transcription, optional Tavily web search.
- Workspace runtime: Docker, `code-server`, Git worktrees, Node.js, Python, and ripgrep inside editor containers.

## Repository Layout

```text
jinoe/
  backend/                  FastAPI app, database models, API routers, assistant runtime
  docker/jinoe-workspace/   Docker image for browser-based code editor sessions
  frontend/                 Next.js dashboard and product UI
```

Key backend modules:

- `backend/main.py` defines the database engine, ORM models, shared Pydantic schemas, and FastAPI app wiring.
- `backend/auth.py` handles signup, login, email verification, invites, sessions, and current-user auth.
- `backend/project.py` manages projects, project members, repository trees, file reads, and zip downloads.
- `backend/tasks.py` manages the task board.
- `backend/task_workflow.py` manages Git worktrees, Docker editor sessions, task submission, and review decisions.
- `backend/ai_tasks.py` runs autonomous AI task attempts and submits them into the same review flow.
- `backend/chat.py` powers project chat, reactions, read receipts, and WebSocket broadcasts.
- `backend/assistant_runtime/` contains the streaming coding assistant, tool execution layer, model client, session state, prompts, and target resolution.

Key frontend areas:

- `frontend/app/(dashboard)/tasks` is the Kanban task board and AI assignment surface.
- `frontend/app/(dashboard)/editor` embeds setup and task editor sessions with live preview support.
- `frontend/app/(dashboard)/reviews` lets owners inspect diffs and approve or decline submitted work.
- `frontend/app/(dashboard)/chat` provides project chat, voice notes, reactions, and read state.
- `frontend/app/(dashboard)/repo` provides repository browsing and archive download.
- `frontend/components/sidebar/WorkspaceAssistantDock.tsx` hosts the streaming assistant UI.

## Local Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL
- Docker Desktop or Docker Engine, required for browser editor sessions and AI workspace tooling

### 1. Configure Environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill in the backend values in `backend/.env`. At minimum, local development needs:

- `DATABASE_URL`
- `SQLALCHEMY_ECHO`
- `FRONTEND_URL`
- `CORS_ALLOW_ORIGINS`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- `OPENAI_API_KEY`, `OPENAI_TRANSCRIBE_URL`, `OPENAI_TRANSCRIBE_MODEL`

The frontend only requires:

- `NEXT_PUBLIC_API_URL=http://localhost:8000`

### 2. Install Backend Dependencies

```bash
cd backend
python3 -m venv env
source env/bin/activate
pip install -r requirements.txt
```

### 3. Install Frontend Dependencies

```bash
cd frontend
npm install
```

The repository currently includes both `package-lock.json` and `pnpm-lock.yaml`. Use one package manager consistently in your local workflow.

### 4. Build the Editor Image

Browser-based project setup and task work use the Docker image defined in `docker/jinoe-workspace/Dockerfile`.

```bash
docker build -t jinoe-workspace:latest docker/jinoe-workspace
```

### 5. Run the App

Start the backend:

```bash
cd backend
source env/bin/activate
uvicorn main:app --reload --port 8000
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`.

## Product Workflow

1. Sign up as the workspace owner and verify the email code.
2. Invite collaborators from the Team page.
3. Create a project and select which teammates can access it.
4. Open the setup editor to create or adjust starter files, then mark setup complete.
5. Create tasks and assign them to a teammate or Jinoe AI.
6. Start a task to open an isolated browser editor session.
7. Submit completed work for review.
8. Approve the review to merge changes back into the project repository, or decline it with feedback.

## Environment And Security Notes

- Real `.env` files are ignored by Git and should never be committed.
- Keep API keys, SMTP credentials, database passwords, and provider tokens out of source control.
- The checked-in `.env.example` files intentionally contain placeholders only.
- Runtime project repositories default to `../jinoe-workspaces`, which is ignored by Git.
- Docker editor containers expose local ports. Keep bind hosts and public hosts conservative for local development.

## Development Commands

Frontend:

```bash
cd frontend
npm run dev
npm run build
npm run lint
```

Backend:

```bash
cd backend
source env/bin/activate
uvicorn main:app --reload --port 8000
```

Database tables are created on FastAPI startup via SQLAlchemy metadata. For production-grade deployments, add a migration tool such as Alembic before evolving schemas across environments.

## Project Status

This is an active full-stack product prototype with real authentication, team/project/task data, Docker-backed editor sessions, AI-assisted task execution, review flows, and realtime chat. The codebase is suitable for demonstrating product engineering depth across frontend systems, backend API design, workflow orchestration, and applied AI tooling.
