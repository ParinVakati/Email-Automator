from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobPosting(Base):
    __tablename__ = "job_postings"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(2048), unique=True, index=True)
    company: Mapped[str | None] = mapped_column(String(255))
    company_domain: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(500))
    location: Mapped[str | None] = mapped_column(String(255))
    job_id: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[str] = mapped_column(Text, default="")
    analyzed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    campaigns: Mapped[list["Campaign"]] = relationship(back_populates="job")


class Recruiter(Base):
    __tablename__ = "recruiters"
    __table_args__ = (UniqueConstraint("email_normalized", name="uq_recruiter_email_normalized"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255), default="")
    company: Mapped[str] = mapped_column(String(255), default="")
    email: Mapped[str] = mapped_column(String(320), index=True)
    email_normalized: Mapped[str] = mapped_column(String(320), index=True)
    source_url: Mapped[str] = mapped_column(String(2048), default="")
    verification_status: Mapped[str] = mapped_column(String(32), default="unknown")
    relevance_score: Mapped[float] = mapped_column(Float, default=0)
    opted_out: Mapped[bool] = mapped_column(Boolean, default=False)


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[str | None] = mapped_column(String(255), index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_postings.id"), index=True)
    requested_count: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped[JobPosting] = relationship(back_populates="campaigns")
    recipients: Mapped[list["CampaignRecipient"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")


class CampaignRecipient(Base):
    __tablename__ = "campaign_recipients"
    __table_args__ = (UniqueConstraint("campaign_id", "recruiter_id", name="uq_campaign_recruiter"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    recruiter_id: Mapped[int] = mapped_column(ForeignKey("recruiters.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    subject: Mapped[str] = mapped_column(String(998), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    gmail_message_id: Mapped[str | None] = mapped_column(String(255), index=True)
    gmail_thread_id: Mapped[str | None] = mapped_column(String(255), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    campaign: Mapped[Campaign] = relationship(back_populates="recipients")
    recruiter: Mapped[Recruiter] = relationship()


class Suppression(Base):
    __tablename__ = "suppression_list"

    id: Mapped[int] = mapped_column(primary_key=True)
    email_normalized: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    reason: Mapped[str] = mapped_column(String(255), default="opt_out")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    account_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    university: Mapped[str] = mapped_column(String(255), default="")
    background: Mapped[str] = mapped_column(String(1000), default="")
    skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    portfolio_url: Mapped[str | None] = mapped_column(String(2048))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class UserActivity(Base):
    __tablename__ = "user_activity"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[str] = mapped_column(String(255), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    summary: Mapped[str] = mapped_column(String(500))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
