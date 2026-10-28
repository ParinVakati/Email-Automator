from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl


class JobAnalyzeRequest(BaseModel):
    url: HttpUrl


class JobOut(BaseModel):
    id: int
    url: str
    company: str | None
    company_domain: str | None
    title: str | None
    location: str | None
    job_id: str | None
    description: str
    requirements: list[str]
    cached: bool = False


class CampaignCreate(BaseModel):
    job_id: int
    requested_count: int = Field(ge=1, le=100)


class RecruiterInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    title: str = Field(default="", max_length=255)
    company: str = Field(default="", max_length=255)
    email: EmailStr
    source_url: HttpUrl
    relevance_score: float = Field(default=0, ge=0, le=1)


class AddRecipients(BaseModel):
    recruiters: list[RecruiterInput] = Field(min_length=1, max_length=100)


class VerifyRequest(BaseModel):
    recruiter_ids: list[int] = Field(min_length=1, max_length=100)


class ProfileInput(BaseModel):
    name: str = Field(default="", max_length=255)
    university: str = Field(default="", max_length=255)
    background: str = Field(default="", max_length=1000)
    skills: list[str] = Field(default_factory=list, max_length=30)
    portfolio_url: HttpUrl | None = None


class GenerateRequest(BaseModel):
    profile: ProfileInput


class DraftUpdate(BaseModel):
    id: int
    subject: str = Field(max_length=998)
    body: str = Field(max_length=10000)


class SaveDrafts(BaseModel):
    recipients: list[DraftUpdate] = Field(min_length=1, max_length=100)


class RecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recruiter_id: int
    status: str
    subject: str
    body: str
    recruiter: "RecruiterOut"


class RecruiterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    title: str
    company: str
    email: str
    source_url: str
    verification_status: str
    relevance_score: float
    opted_out: bool


class CampaignOut(BaseModel):
    id: int
    job_id: int
    requested_count: int
    status: str
    created_at: str
    job: JobOut | None = None
    recipients: list[RecipientOut] = []
