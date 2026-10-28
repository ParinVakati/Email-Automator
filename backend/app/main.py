import re
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.auth import require_auth
from app.config import settings
from app.database import Base, SessionLocal, engine, migrate_schema
from app.job_analysis import extract_job, fetch_public_page
from app.models import Campaign, CampaignRecipient, JobPosting, Recruiter, Suppression, UserActivity, UserProfile
from app.schemas import AddRecipients, CampaignCreate, CampaignOut, GenerateRequest, JobAnalyzeRequest, JobOut, ProfileInput, RecruiterOut, SaveDrafts, VerifyRequest

Base.metadata.create_all(bind=engine)
migrate_schema()
app = FastAPI(title="RecruiterReach API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _job_output(job: JobPosting, cached: bool = False) -> dict:
    skills = ("Python", "Java", "TypeScript", "JavaScript", "React", "SQL", "AWS", "Azure", "C++", "Go", "Kubernetes", "Machine Learning")
    return {
        "id": job.id, "url": job.url, "company": job.company, "company_domain": job.company_domain,
        "title": job.title, "location": job.location, "job_id": job.job_id, "description": job.description,
        "requirements": [s for s in skills if s.lower() in job.description.lower()], "cached": cached,
    }


def _campaign_output(campaign: Campaign) -> dict:
    return {
        "id": campaign.id, "job_id": campaign.job_id, "requested_count": campaign.requested_count,
        "status": campaign.status, "created_at": campaign.created_at.isoformat(),
        "job": _job_output(campaign.job) if campaign.job else None, "recipients": [
            {"id": item.id, "recruiter_id": item.recruiter_id, "status": item.status, "subject": item.subject,
             "body": item.body, "recruiter": RecruiterOut.model_validate(item.recruiter).model_dump()}
            for item in campaign.recipients
        ],
    }


def _record_activity(
    db: Session,
    account_id: str,
    event_type: str,
    summary: str,
    details: dict | None = None,
    campaign_id: int | None = None,
) -> None:
    db.add(UserActivity(
        account_id=account_id,
        event_type=event_type,
        summary=summary,
        details=details or {},
        campaign_id=campaign_id,
    ))


def _load_campaign(db: Session, campaign_id: int, account_id: str) -> Campaign:
    campaign = db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.account_id == account_id).options(
            joinedload(Campaign.job),
            joinedload(Campaign.recipients).joinedload(CampaignRecipient.recruiter)
        )
    ).unique().scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/jobs/analyze", response_model=JobOut)
async def analyze_job(payload: JobAnalyzeRequest, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    url = str(payload.url)
    existing = db.scalar(select(JobPosting).where(JobPosting.url == url))
    if existing:
        _record_activity(db, account_id, "job_analyzed", f"Reviewed job posting: {existing.title or existing.url}", {"job_id": existing.id, "url": url})
        db.commit()
        return _job_output(existing, cached=True)
    html = await fetch_public_page(url)
    parsed = extract_job(url, html)
    job = JobPosting(url=url, **{key: parsed[key] for key in ("title", "company", "company_domain", "location", "job_id", "description")})
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        job = db.scalar(select(JobPosting).where(JobPosting.url == url))
        if not job:
            raise HTTPException(status_code=409, detail="Job posting was concurrently saved")
    db.refresh(job)
    _record_activity(db, account_id, "job_analyzed", f"Analyzed job posting: {job.title or job.url}", {"job_id": job.id, "url": url})
    db.commit()
    return _job_output(job)


@app.post("/api/campaigns", response_model=CampaignOut)
def create_campaign(payload: CampaignCreate, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    if payload.requested_count > settings.max_campaign_recipients:
        raise HTTPException(status_code=422, detail=f"Requested count exceeds configured limit ({settings.max_campaign_recipients})")
    if not db.get(JobPosting, payload.job_id):
        raise HTTPException(status_code=404, detail="Job posting not found")
    campaign = Campaign(account_id=account_id, job_id=payload.job_id, requested_count=payload.requested_count)
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    _record_activity(db, account_id, "campaign_created", "Started a new outreach campaign", {"job_id": payload.job_id}, campaign.id)
    db.commit()
    return _campaign_output(_load_campaign(db, campaign.id, account_id))


@app.get("/api/campaigns")
def list_campaigns(account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaigns = db.scalars(select(Campaign).where(Campaign.account_id == account_id).options(joinedload(Campaign.job), joinedload(Campaign.recipients).joinedload(CampaignRecipient.recruiter)).order_by(Campaign.created_at.desc())).unique().all()
    return [_campaign_output(campaign) for campaign in campaigns]


@app.get("/api/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    return _campaign_output(_load_campaign(db, campaign_id, account_id))


@app.post("/api/campaigns/{campaign_id}/recruiters", response_model=CampaignOut)
def add_recruiters(campaign_id: int, payload: AddRecipients, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaign = _load_campaign(db, campaign_id, account_id)
    if campaign.status not in {"draft"}:
        raise HTTPException(status_code=409, detail="Recipients can only be changed on a draft campaign")
    current_ids = {item.recruiter_id for item in campaign.recipients}
    remaining = min(campaign.requested_count, settings.max_campaign_recipients) - len(current_ids)
    if len(payload.recruiters) > remaining:
        raise HTTPException(status_code=422, detail=f"Campaign has room for only {max(remaining, 0)} more recipient(s)")
    initial_count = len(current_ids)
    for candidate in payload.recruiters:
        email = str(candidate.email).lower().strip()
        if db.scalar(select(Suppression.id).where(Suppression.email_normalized == email)):
            continue
        recruiter = db.scalar(select(Recruiter).where(Recruiter.email_normalized == email))
        if recruiter is None:
            recruiter = Recruiter(
                name=candidate.name, title=candidate.title, company=candidate.company, email=str(candidate.email),
                email_normalized=email, source_url=str(candidate.source_url), verification_status="unknown",
                relevance_score=candidate.relevance_score,
            )
            db.add(recruiter)
            db.flush()
        if recruiter.id not in current_ids and not recruiter.opted_out:
            db.add(CampaignRecipient(campaign=campaign, recruiter=recruiter))
            current_ids.add(recruiter.id)
    db.commit()
    added_count = len(current_ids) - initial_count
    _record_activity(db, account_id, "contacts_added", f"Added {added_count} recruiter contact(s)", {"campaign_id": campaign_id, "count": added_count}, campaign_id)
    db.commit()
    return _campaign_output(_load_campaign(db, campaign_id, account_id))


@app.post("/api/recruiters/verify")
async def verify_recruiters(payload: VerifyRequest, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    if not settings.hunter_api_key:
        raise HTTPException(status_code=503, detail="Email verification requires a configured Hunter API key")
    if len(set(payload.recruiter_ids)) != len(payload.recruiter_ids):
        raise HTTPException(status_code=422, detail="Recruiter IDs must be unique")
    recruiters = db.scalars(
        select(Recruiter)
        .join(CampaignRecipient, CampaignRecipient.recruiter_id == Recruiter.id)
        .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
        .where(Campaign.account_id == account_id, Recruiter.id.in_(payload.recruiter_ids))
        .distinct()
    ).all()
    if len(recruiters) != len(set(payload.recruiter_ids)):
        raise HTTPException(status_code=404, detail="One or more recruiter records were not found")
    statuses = []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            for recruiter in recruiters:
                if recruiter.verification_status == "valid":
                    statuses.append({"recruiter_id": recruiter.id, "status": "valid", "cached": True})
                    continue
                response = await client.get(
                    "https://api.hunter.io/v2/email-verifier",
                    params={"email": recruiter.email, "api_key": settings.hunter_api_key},
                )
                if response.status_code >= 400:
                    raise HTTPException(status_code=502, detail="Hunter email verification request failed")
                result = response.json().get("data", {}).get("status")
                recruiter.verification_status = result if result in {"valid", "invalid"} else "unknown"
                statuses.append({"recruiter_id": recruiter.id, "status": recruiter.verification_status})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Hunter email verification request failed") from exc
    db.commit()
    return {"results": statuses}


@app.post("/api/campaigns/{campaign_id}/generate", response_model=CampaignOut)
def generate_emails(campaign_id: int, payload: GenerateRequest, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaign = _load_campaign(db, campaign_id, account_id)
    if campaign.status != "draft":
        raise HTTPException(status_code=409, detail="Emails can only be generated for a draft campaign")
    if not payload.profile.name.strip():
        raise HTTPException(status_code=422, detail="Your name is required to generate email drafts")
    job = db.get(JobPosting, campaign.job_id)
    for item in campaign.recipients:
        if item.status != "draft":
            continue
        recruiter = item.recruiter
        first_name = recruiter.name.strip().split()[0] if recruiter.name.strip() else "there"
        name = " ".join(payload.profile.name.split()[:5])
        context = " / ".join([v for v in [" ".join(payload.profile.university.split()[:5]), " ".join(payload.profile.background.split()[:10])] if v])
        skills = ", ".join(" ".join(skill.split()[:4]) for skill in payload.profile.skills[:2])
        role = " ".join((job.title or "the role").split()[:12])
        company = " ".join((job.company or "").split()[:6])
        subject = f"{job.title or 'Opportunity'} — {name}"
        job_reference = f" ({job.job_id})" if job.job_id else ""
        portfolio = f"\n{payload.profile.portfolio_url}" if payload.profile.portfolio_url else ""
        body = (
            f"Hi {first_name},\n\n"
            f"I'm {name}, {context or 'a candidate'}"
            f"{f' with experience in {skills}' if skills else ''}. I'm interested in {job.title or 'the role'}"
            f"{f' at {company}' if company else ''}{job_reference}.\n\n"
            f"Would you be the right person to ask about this opportunity?\n\n"
            f"Thanks,\n{name}{portfolio}"
        )
        if len(body.split()) > 85:
            body = body.replace(job.title or "the role", role, 1)
        item.subject = subject[:998]
        item.body = body
    db.commit()
    _record_activity(db, account_id, "drafts_generated", f"Generated {len(campaign.recipients)} editable email draft(s)", {"campaign_id": campaign_id}, campaign_id)
    db.commit()
    return _campaign_output(_load_campaign(db, campaign_id, account_id))


@app.post("/api/campaigns/{campaign_id}/approve", response_model=CampaignOut)
def approve_campaign(campaign_id: int, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaign = _load_campaign(db, campaign_id, account_id)
    if campaign.status != "draft" or not campaign.recipients:
        raise HTTPException(status_code=409, detail="A draft campaign with recipients is required")
    eligible = [r for r in campaign.recipients if r.subject and r.body and not r.recruiter.opted_out and r.recruiter.verification_status == "valid"]
    if len(eligible) != len(campaign.recipients):
        raise HTTPException(status_code=422, detail="Every recipient needs a verified valid email and a generated draft")
    if len(eligible) > campaign.requested_count or len(eligible) > settings.max_campaign_recipients:
        raise HTTPException(status_code=422, detail="Recipient limit exceeded")
    campaign.status = "approved"
    for recipient in eligible:
        recipient.status = "approved"
    db.commit()
    _record_activity(db, account_id, "campaign_approved", "Approved campaign emails for review", {"campaign_id": campaign_id}, campaign_id)
    db.commit()
    return _campaign_output(_load_campaign(db, campaign_id, account_id))


@app.post("/api/campaigns/{campaign_id}/drafts", response_model=CampaignOut)
def save_drafts(campaign_id: int, payload: SaveDrafts, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaign = _load_campaign(db, campaign_id, account_id)
    if campaign.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft campaigns can be edited")
    recipients = {item.id: item for item in campaign.recipients}
    if len({item.id for item in payload.recipients}) != len(payload.recipients):
        raise HTTPException(status_code=422, detail="Draft recipients must be unique")
    for update in payload.recipients:
        recipient = recipients.get(update.id)
        if recipient is None:
            raise HTTPException(status_code=404, detail="Draft recipient does not belong to this campaign")
        recipient.subject = update.subject.strip()
        recipient.body = update.body.strip()
    db.commit()
    _record_activity(db, account_id, "drafts_updated", f"Edited {len(payload.recipients)} email draft(s)", {"campaign_id": campaign_id}, campaign_id)
    db.commit()
    return _campaign_output(_load_campaign(db, campaign_id, account_id))


@app.post("/api/campaigns/{campaign_id}/launch")
def launch_campaign(campaign_id: int, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaign = _load_campaign(db, campaign_id, account_id)
    if campaign.status != "approved":
        raise HTTPException(status_code=409, detail="Campaign must be approved before launch")
    raise HTTPException(status_code=503, detail="Gmail OAuth and the durable send worker are not configured in this build; no emails were sent")


@app.post("/api/recruiters/discover")
async def discover_recruiters(job_id: int, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    if not db.scalar(select(Campaign.id).where(Campaign.account_id == account_id, Campaign.job_id == job_id)):
        raise HTTPException(status_code=404, detail="Create a campaign for this job before discovering contacts")
    job = db.get(JobPosting, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job posting not found")
    if not settings.brave_search_api_key:
        raise HTTPException(status_code=503, detail="Recruiter discovery requires a configured Brave Search API key")
    if not settings.hunter_api_key:
        raise HTTPException(status_code=503, detail="Recruiter discovery requires a configured Hunter API key")
    domain = job.company_domain
    if not domain:
        raise HTTPException(status_code=422, detail="The job posting did not provide a company domain")
    campaign_limit = min(settings.max_campaign_recipients * 3, 100)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            search = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": f"site:{domain} recruiter talent acquisition"},
                headers={"X-Subscription-Token": settings.brave_search_api_key},
            )
            if search.status_code >= 400:
                raise HTTPException(status_code=502, detail="Brave Search request failed")
            hunter = await client.get(
                "https://api.hunter.io/v2/domain-search",
                params={"domain": domain, "api_key": settings.hunter_api_key, "limit": campaign_limit},
            )
            if hunter.status_code >= 400:
                raise HTTPException(status_code=502, detail="Hunter contact lookup failed")
            search_results = search.json().get("web", {}).get("results", [])
            contacts = hunter.json().get("data", {}).get("emails", [])
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Recruiter provider request failed") from exc
    official_urls = [
        entry.get("url", "") for entry in search_results
        if urlparse(entry.get("url", "")).hostname
        and ((urlparse(entry["url"]).hostname or "").lower() == domain.lower()
             or (urlparse(entry["url"]).hostname or "").lower().endswith(f".{domain.lower()}"))
    ]
    results = []
    for person in contacts:
        email = str(person.get("value", "")).lower()
        title = person.get("position") or ""
        if not email or not re.search(r"recruit|talent|human resources|hr", title, re.I):
            continue
        results.append({
            "name": " ".join(filter(None, [person.get("first_name"), person.get("last_name")])),
            "title": title, "company": job.company or "", "email": email,
            "source_url": person.get("sources", [{}])[0].get("uri") if person.get("sources") else (official_urls[0] if official_urls else f"https://{domain}"),
            "verification_status": (
                person.get("verification", {}).get("status", "unknown")
                if isinstance(person.get("verification"), dict)
                else person.get("verification", "unknown")
            ),
            "relevance_score": 0.8 if "recruit" in title.lower() else 0.6,
        })
    return {"recruiters": results, "count": len(results), "requested_maximum": campaign_limit}


@app.post("/api/recruiters/{recruiter_id}/opt-out")
def opt_out_recruiter(recruiter_id: int, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    recruiter = db.scalar(
        select(Recruiter)
        .join(CampaignRecipient, CampaignRecipient.recruiter_id == Recruiter.id)
        .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
        .where(Recruiter.id == recruiter_id, Campaign.account_id == account_id)
    )
    if recruiter is None:
        raise HTTPException(status_code=404, detail="Recruiter not found")
    recruiter.opted_out = True
    if not db.scalar(select(Suppression.id).where(Suppression.email_normalized == recruiter.email_normalized)):
        db.add(Suppression(email_normalized=recruiter.email_normalized, reason="opt_out"))
    db.commit()
    _record_activity(db, account_id, "contact_opted_out", f"Suppressed {recruiter.email} from future outreach", {"recruiter_id": recruiter_id})
    db.commit()
    return {"status": "opted_out"}


@app.get("/api/analytics")
def analytics(account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    campaigns = db.scalars(select(Campaign).where(Campaign.account_id == account_id).options(joinedload(Campaign.recipients))).unique().all()
    recipients = [recipient for campaign in campaigns for recipient in campaign.recipients]
    sent = sum(recipient.status == "sent" for recipient in recipients)
    replied = sum(recipient.status == "replied" for recipient in recipients)
    return {
        "campaigns": len(campaigns), "contacts": len(recipients), "sent": sent, "replies": replied,
        "response_rate": replied / sent if sent else 0,
        "note": "Send and reply totals remain zero until Gmail integration is configured.",
    }


@app.get("/api/profile")
def get_profile(account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    profile = db.get(UserProfile, account_id)
    if profile is None:
        return {"name": "", "university": "", "background": "", "skills": [], "portfolio_url": None}
    return {
        "name": profile.name,
        "university": profile.university,
        "background": profile.background,
        "skills": profile.skills,
        "portfolio_url": profile.portfolio_url,
    }


@app.put("/api/profile")
def save_profile(payload: ProfileInput, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    profile = db.get(UserProfile, account_id)
    if profile is None:
        profile = UserProfile(account_id=account_id)
        db.add(profile)
    profile.name = payload.name.strip()
    profile.university = payload.university.strip()
    profile.background = payload.background.strip()
    profile.skills = payload.skills
    profile.portfolio_url = str(payload.portfolio_url) if payload.portfolio_url else None
    db.commit()
    _record_activity(db, account_id, "profile_updated", "Updated personal profile")
    db.commit()
    return get_profile(account_id, db)


@app.get("/api/activity")
def get_activity(limit: int = 50, account_id: str = Depends(require_auth), db: Session = Depends(get_db)):
    if not 1 <= limit <= 100:
        raise HTTPException(status_code=422, detail="Activity limit must be between 1 and 100")
    activities = db.scalars(
        select(UserActivity)
        .where(UserActivity.account_id == account_id)
        .order_by(UserActivity.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": item.id,
            "type": item.event_type,
            "summary": item.summary,
            "details": item.details,
            "campaign_id": item.campaign_id,
            "created_at": item.created_at.isoformat(),
        }
        for item in activities
    ]
