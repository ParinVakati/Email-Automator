from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app import auth
from app.config import settings


def test_authentication_fails_closed_when_supabase_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", None)
    with pytest.raises(HTTPException) as error:
        auth.require_auth("Bearer token")
    assert error.value.status_code == 503


def test_authentication_requires_bearer_token(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    with pytest.raises(HTTPException) as error:
        auth.require_auth(None)
    assert error.value.status_code == 401


def test_authentication_validates_supabase_jwt_and_returns_account_id(monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class SigningKey:
        key = private_key.public_key()
        algorithm_name = "RS256"

    class FakeJwksClient:
        @staticmethod
        def get_signing_key_from_jwt(_token):
            return SigningKey()

    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(auth, "_jwks_client", lambda _issuer: FakeJwksClient())
    token = jwt.encode(
        {
            "sub": "account-123",
            "aud": "authenticated",
            "iss": "https://project.supabase.co/auth/v1",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        private_key,
        algorithm="RS256",
    )
    assert auth.require_auth(f"Bearer {token}") == "account-123"


def test_authentication_rejects_token_from_another_project(monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class SigningKey:
        key = private_key.public_key()
        algorithm_name = "RS256"

    class FakeJwksClient:
        @staticmethod
        def get_signing_key_from_jwt(_token):
            return SigningKey()

    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(auth, "_jwks_client", lambda _issuer: FakeJwksClient())
    token = jwt.encode(
        {
            "sub": "account-123",
            "aud": "authenticated",
            "iss": "https://attacker.example/auth/v1",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        private_key,
        algorithm="RS256",
    )
    with pytest.raises(HTTPException) as error:
        auth.require_auth(f"Bearer {token}")
    assert error.value.status_code == 401
