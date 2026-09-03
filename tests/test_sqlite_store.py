import sqlite3

from fastapi.testclient import TestClient

from backend import main as backend_main


def test_database_tables_exist_and_are_queryable(tmp_path, monkeypatch):
    db_path = tmp_path / "loopback.db"
    monkeypatch.setattr(backend_main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(backend_main, "DB_PATH", db_path)
    monkeypatch.setattr(backend_main, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setattr(backend_main, "DATA_FILE", tmp_path / "contacts.json")
    backend_main.sessions.clear()

    backend_main.init_db()

    with sqlite3.connect(db_path) as conn:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        ).fetchall()

    assert {row[0] for row in tables} >= {"users", "contacts", "sessions"}


def test_register_and_login_flow_is_authenticated(tmp_path, monkeypatch):
    db_path = tmp_path / "loopback.db"
    monkeypatch.setattr(backend_main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(backend_main, "DB_PATH", db_path)
    monkeypatch.setattr(backend_main, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setattr(backend_main, "DATA_FILE", tmp_path / "contacts.json")
    backend_main.sessions.clear()
    backend_main.init_db()

    with TestClient(backend_main.app) as client:
        response = client.post(
            "/api/auth/register",
            json={"name": "Test User", "email": "test@example.com", "password": "secretpass"},
        )
        assert response.status_code == 200, response.text

        payload = response.json()
        token = payload["token"]
        assert token
        assert payload["user"]["email"] == "test@example.com"

        me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200, me.text
        assert me.json()["email"] == "test@example.com"

        contacts = client.get(
            "/api/contacts",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert contacts.status_code == 200, contacts.text
        assert isinstance(contacts.json(), list)
