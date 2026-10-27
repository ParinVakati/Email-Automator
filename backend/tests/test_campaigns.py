from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.config import settings
from app.database import Base
from app.models import JobPosting


def make_client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[main.get_db] = override_db
    monkeypatch.setattr(settings, "app_access_token", "test-token")
    monkeypatch.setattr(settings, "max_campaign_recipients", 2)
    with test_session() as db:
        db.add(JobPosting(url="https://example.com/job", title="Engineer", company="Example", company_domain="example.com", description="Python"))
        db.commit()
        job_id = db.query(JobPosting).first().id
    return TestClient(main.app), job_id, engine


def test_campaign_rejects_request_over_configured_limit(monkeypatch):
    client, job_id, engine = make_client(monkeypatch)
    response = client.post("/api/campaigns", headers={"Authorization": "Bearer test-token"}, json={"job_id": job_id, "requested_count": 3})
    assert response.status_code == 422
    main.app.dependency_overrides.clear()
    engine.dispose()


def test_campaign_creation_requires_auth_and_persists(monkeypatch):
    client, job_id, engine = make_client(monkeypatch)
    assert client.post("/api/campaigns", json={"job_id": job_id, "requested_count": 2}).status_code == 401
    response = client.post("/api/campaigns", headers={"Authorization": "Bearer test-token"}, json={"job_id": job_id, "requested_count": 2})
    assert response.status_code == 200
    assert response.json()["requested_count"] == 2
    main.app.dependency_overrides.clear()
    engine.dispose()


def test_campaign_draft_edit_is_persisted_before_approval(monkeypatch):
    client, job_id, engine = make_client(monkeypatch)
    auth = {"Authorization": "Bearer test-token"}
    monkeypatch.setattr(settings, "hunter_api_key", "test-hunter-key")
    created = client.post("/api/campaigns", headers=auth, json={"job_id": job_id, "requested_count": 1}).json()
    campaign_id = created["id"]
    added = client.post(
        f"/api/campaigns/{campaign_id}/recruiters",
        headers=auth,
        json={"recruiters": [{
            "name": "Alex Recruiter", "title": "Technical Recruiter", "company": "Example",
            "email": "alex@example.com", "source_url": "https://example.com/team",
            "relevance_score": 0.9,
        }]},
    ).json()
    recipient_id = added["recipients"][0]["id"]

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"data": {"status": "valid"}}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    verified = client.post("/api/recruiters/verify", headers=auth, json={"recruiter_ids": [added["recipients"][0]["recruiter_id"]]})
    assert verified.status_code == 200
    assert verified.json()["results"][0]["status"] == "valid"
    generated = client.post(
        f"/api/campaigns/{campaign_id}/generate",
        headers=auth,
        json={"profile": {"name": "Casey Candidate", "university": "Example University", "background": "Computer science student", "skills": ["Python", "SQL"]}},
    ).json()
    assert len(generated["recipients"][0]["body"].split()) <= 85
    edited = client.post(
        f"/api/campaigns/{campaign_id}/drafts",
        headers=auth,
        json={"recipients": [{"id": recipient_id, "subject": "Updated subject", "body": "Updated approved body."}]},
    )
    assert edited.status_code == 200
    approved = client.post(f"/api/campaigns/{campaign_id}/approve", headers=auth)
    assert approved.status_code == 200
    assert approved.json()["recipients"][0]["subject"] == "Updated subject"
    assert approved.json()["recipients"][0]["body"] == "Updated approved body."
    launch = client.post(f"/api/campaigns/{campaign_id}/launch", headers=auth)
    assert launch.status_code == 503
    assert "no emails were sent" in launch.json()["detail"]
    main.app.dependency_overrides.clear()
    engine.dispose()
