from __future__ import annotations

import os
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SQLALCHEMY_ECHO", "false")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("CORS_ALLOW_ORIGINS", "http://localhost:3000")
os.environ.setdefault("SMTP_HOST", "localhost")
os.environ.setdefault("SMTP_PORT", "1025")
os.environ.setdefault("SMTP_USER", "test")
os.environ.setdefault("SMTP_PASSWORD", "test")
os.environ.setdefault("SMTP_FROM", "test@example.com")
os.environ.setdefault("OPENAI_TRANSCRIBE_URL", "http://localhost/transcribe")
os.environ.setdefault("OPENAI_TRANSCRIBE_MODEL", "test-transcribe")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

# Import the application module first so its route modules can share the model
# definitions it owns without tripping their circular import pattern during
# isolated unit-test imports.
import main  # noqa: E402,F401
