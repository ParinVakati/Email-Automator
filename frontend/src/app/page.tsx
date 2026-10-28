"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownLeft, ArrowUpRight, BriefcaseBusiness, Check, ChevronRight,
  CircleAlert, Clock3, Command, FileUser, LayoutDashboard, LoaderCircle, LogOut,
  Mail, Plus, Search, Settings2, ShieldCheck, Sparkles, Users,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Job = { id: number; url: string; company?: string; title?: string; location?: string; job_id?: string; description: string; requirements: string[]; cached: boolean };
type Recruiter = { id?: number; name: string; title: string; company: string; email: string; source_url: string; verification_status: string; relevance_score: number };
type Recipient = { id: number; recruiter_id: number; status: string; subject: string; body: string; recruiter: Recruiter };
type Campaign = { id: number; job_id: number; status: string; requested_count: number; created_at: string; job: Job | null; recipients: Recipient[] };
type Profile = { name: string; university: string; background: string; skills: string[]; portfolio_url: string | null };
type ActivityItem = { id: number; type: string; summary: string; created_at: string; campaign_id: number | null };
type Analytics = { campaigns: number; contacts: number; sent: number; replies: number; response_rate: number };

const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const emptyProfile: Profile = { name: "", university: "", background: "", skills: [], portfolio_url: null };
const navItems = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "New campaign", icon: Plus },
  { label: "Campaigns", icon: BriefcaseBusiness },
  { label: "Contacts", icon: Users },
  { label: "Email activity", icon: Mail },
  { label: "My profile", icon: FileUser },
];

export default function Home() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(3);
  const [job, setJob] = useState<Job | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Recruiter[]>([]);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [skillText, setSkillText] = useState("");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({ campaigns: 0, contacts: 0, sent: 0, replies: 0, response_rate: 0 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("Overview");

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setAuthReady(true);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const call = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!session) throw new Error("Please sign in again to continue.");
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data as T;
  }, [session]);

  const refreshAccount = useCallback(async () => {
    if (!session) return;
    const [nextCampaigns, nextActivity, nextProfile, nextAnalytics] = await Promise.all([
      call<Campaign[]>("/api/campaigns"),
      call<ActivityItem[]>("/api/activity"),
      call<Profile>("/api/profile"),
      call<Analytics>("/api/analytics"),
    ]);
    setCampaigns(nextCampaigns);
    setActivity(nextActivity);
    setProfile(nextProfile);
    setSkillText(nextProfile.skills.join(", "));
    setAnalytics(nextAnalytics);
  }, [call, session]);

  useEffect(() => {
    if (!session) {
      setCampaigns([]);
      setActivity([]);
      setAnalytics({ campaigns: 0, contacts: 0, sent: 0, replies: 0, response_rate: 0 });
      setCampaign(null);
      setContacts([]);
      setJob(null);
      setProfile(emptyProfile);
      setSkillText("");
      return;
    }
    void refreshAccount().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load your account data.");
    });
  }, [refreshAccount, session]);

  async function perform(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try { await work(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); }
    finally { setBusy(""); }
  }

  async function signIn() {
    if (!supabase) return;
    await perform("sign-in", async () => {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (signInError) throw signInError;
    });
  }

  async function signOut() {
    if (!supabase) return;
    await perform("sign-out", async () => {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    });
  }

  async function analyzeJob() {
    await perform("Analyzing job", async () => {
      const result = await call<Job>("/api/jobs/analyze", { method: "POST", body: JSON.stringify({ url }) });
      setJob(result);
      setCampaign(null);
      setContacts([]);
      await refreshAccount();
    });
  }

  async function discoverContacts() {
    if (!job) return;
    await perform("Finding contacts", async () => {
      const created = campaign || await call<Campaign>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ job_id: job.id, requested_count: limit }),
      });
      setCampaign(created);
      const found = await call<{ recruiters: Recruiter[] }>(`/api/recruiters/discover?job_id=${job.id}`, { method: "POST" });
      setContacts(found.recruiters);
      if (!found.recruiters.length) setNotice("No matching verified recruiter contacts were found.");
      await refreshAccount();
    });
  }

  async function addContacts() {
    if (!campaign) return;
    await perform("Saving contacts", async () => {
      const saved = await call<Campaign>(`/api/campaigns/${campaign.id}/recruiters`, {
        method: "POST",
        body: JSON.stringify({ recruiters: contacts.slice(0, limit) }),
      });
      setCampaign(saved);
      setNotice(`Added ${saved.recipients.length} eligible contact(s) to this campaign.`);
      await refreshAccount();
    });
  }

  async function verifyContacts() {
    if (!campaign) return;
    await perform("Verifying contacts", async () => {
      await call("/api/recruiters/verify", {
        method: "POST",
        body: JSON.stringify({ recruiter_ids: campaign.recipients.map((item) => item.recruiter_id) }),
      });
      setCampaign(await call<Campaign>(`/api/campaigns/${campaign.id}`));
      setNotice("Contact verification updated by Hunter.io.");
    });
  }

  async function generateDrafts() {
    if (!campaign) return;
    await perform("Generating drafts", async () => {
      const savedProfile = await call<Profile>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ ...profile, skills: skillText.split(",").map((skill) => skill.trim()).filter(Boolean) }),
      });
      setProfile(savedProfile);
      setSkillText(savedProfile.skills.join(", "));
      setCampaign(await call<Campaign>(`/api/campaigns/${campaign.id}/generate`, {
        method: "POST",
        body: JSON.stringify({ profile: savedProfile }),
      }));
      await refreshAccount();
    });
  }

  async function approveCampaign() {
    if (!campaign) return;
    await perform("Approving", async () => {
      await call(`/api/campaigns/${campaign.id}/drafts`, {
        method: "POST",
        body: JSON.stringify({ recipients: campaign.recipients.map(({ id, subject, body }) => ({ id, subject, body })) }),
      });
      setCampaign(await call<Campaign>(`/api/campaigns/${campaign.id}/approve`, { method: "POST" }));
      setNotice("Campaign approved. Gmail sending is not configured in this version.");
      await refreshAccount();
    });
  }

  async function saveProfile() {
    await perform("Saving profile", async () => {
      const saved = await call<Profile>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ ...profile, skills: skillText.split(",").map((skill) => skill.trim()).filter(Boolean) }),
      });
      setProfile(saved);
      setSkillText(saved.skills.join(", "));
      setNotice("Your profile was saved to your account.");
      await refreshAccount();
    });
  }

  const step = campaign ? campaign.recipients.some((recipient) => recipient.subject) ? 4 : campaign.recipients.length ? 3 : 2 : job ? 2 : 1;
  const displayName = session?.user.user_metadata?.full_name || session?.user.user_metadata?.name || session?.user.email || "Your account";
  const avatar = session?.user.user_metadata?.avatar_url || session?.user.user_metadata?.picture;

  if (!authReady) {
    return <main className="auth-page"><div className="auth-card"><div className="brand-mark">R</div><div className="auth-loading"><LoaderCircle className="animate-spin" size={18} /> Securing your workspace…</div></div></main>;
  }

  if (!session) {
    return (
      <main className="auth-page">
        <div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" />
        <section className="auth-card">
          <div className="brand-mark">R</div>
          <div className="eyebrow">YOUR NEXT OPPORTUNITY, CLOSER</div>
          <h1>Make a thoughtful<br /><span>first impression.</span></h1>
          <p className="auth-copy">A quieter, more personal way to manage recruiter outreach. Your campaigns and profile stay with your account.</p>
          {!supabase ? (
            <div className="setup-callout"><CircleAlert size={18} /><div><strong>Google sign-in needs setup</strong><p>Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to the frontend environment, then configure Google as a Supabase OAuth provider.</p></div></div>
          ) : (
            <button className="google-button" disabled={busy === "sign-in"} onClick={signIn}>
              {busy === "sign-in" ? <LoaderCircle className="animate-spin" size={18} /> : <GoogleIcon />}
              Continue with Google
              <ArrowUpRight size={16} className="google-arrow" />
            </button>
          )}
          {error && <div role="alert" className="auth-error"><CircleAlert size={16} />{error}</div>}
          <div className="auth-foot"><ShieldCheck size={15} /> Private by design <span>·</span> Only you can access your workspace</div>
        </section>
        <div className="auth-caption">RecruiterReach <span>·</span> Thoughtful outreach, all in one place</div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#" onClick={(event) => { event.preventDefault(); setView("Overview"); }}>
          <span className="brand-mark brand-mark-small">R</span><span><strong>RecruiterReach</strong><small>PERSONAL WORKSPACE</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} onClick={() => setView(label)} className={`nav-link ${view === label ? "is-active" : ""}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === "New campaign" && <span className="nav-plus">+</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><ShieldCheck size={17} /><div><strong>Your workspace is private</strong><span>Campaigns are saved to your account.</span></div></div>
          <button className="account-button" onClick={signOut}>
            {avatar ? <img className="avatar" src={avatar} alt="" /> : <span className="avatar avatar-fallback">{displayName.slice(0, 1).toUpperCase()}</span>}
            <span className="account-copy"><strong>{displayName}</strong><small>{session.user.email}</small></span>
            <LogOut size={16} className="logout-icon" />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{view}</strong></div>
          <div className="topbar-right"><span className="secure-pill"><span />Private account</span><span className="topbar-date">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date())}</span></div>
        </header>

        <div className="content-area">
          {error && <div role="alert" className="notice notice-error"><CircleAlert size={17} />{error}<button onClick={() => setError("")}>Dismiss</button></div>}
          {notice && <div role="status" className="notice notice-success"><Check size={17} />{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}

          {view === "Overview" && <Overview analytics={analytics} activity={activity} campaigns={campaigns} onNavigate={setView} />}

          {view === "New campaign" && (
            <section className="page-section">
              <div className="page-heading"><div><div className="eyebrow">A BETTER WAY TO REACH OUT</div><h1>Create a campaign</h1><p>Start with a role that feels like the right fit. You stay in control at every step.</p></div><div className="heading-stamp"><Sparkles size={16} /> PERSONAL, NEVER AUTOMATED</div></div>
              <div className="step-track">
                {["Analyze role", "Find people", "Write drafts", "Review"].map((item, index) => <div key={item} className={`step-item ${step >= index + 1 ? "step-current" : ""}`}><span className="step-number">{step > index + 1 ? <Check size={14} /> : `0${index + 1}`}</span><span>{item}</span>{index < 3 && <span className="step-rule" />}</div>)}
              </div>
              <section className="surface-card campaign-start">
                <div className="section-title"><span className="section-icon"><Search size={17} /></span><div><h2>Start with a job posting</h2><p>We’ll read the public listing and prepare a concise role summary.</p></div></div>
                <form className="job-form" onSubmit={(event) => { event.preventDefault(); void analyzeJob(); }}>
                  <label className="input-group job-url-field"><span>JOB POSTING URL</span><input className="dark-input" type="url" required placeholder="https://careers.company.com/jobs/..." value={url} onChange={(event) => setUrl(event.target.value)} /></label>
                  <label className="input-group contacts-field"><span>MAX CONTACTS</span><input className="dark-input" type="number" min={1} max={10} value={limit} onChange={(event) => setLimit(Math.min(10, Math.max(1, Number(event.target.value))))} /></label>
                  <button className="button-primary" disabled={!!busy}>{busy === "Analyzing job" ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}Analyze role</button>
                </form>
                <div className="form-footnote"><ShieldCheck size={14} /> Public HTTPS job pages only <span>·</span> Maximum 10 contacts per campaign</div>
                {job && <div className="job-summary">
                  <div className="job-summary-top"><div><span className="status-dot" />{job.cached ? "SAVED ROLE" : "ROLE ANALYZED"}</div><span>{job.location || "Location not detected"}</span></div>
                  <h3>{job.title || "Job title not detected"}{job.company ? <span> at {job.company}</span> : null}</h3>
                  <p>{job.description}</p>
                  <div className="job-tags">{job.requirements.length ? job.requirements.map((requirement) => <span key={requirement}>{requirement}</span>) : <span>Requirements not detected</span>}</div>
                  <div className="job-summary-actions"><span>{job.job_id ? `Job ID ${job.job_id}` : "Check the extracted role before continuing"}</span><button className="button-secondary" disabled={!!busy} onClick={discoverContacts}>{busy === "Finding contacts" ? <LoaderCircle className="animate-spin" size={15} /> : <Users size={15} />}Find recruiters</button></div>
                </div>}
              </section>
              {job && <section className="surface-card discovery-card">
                <div className="section-title section-title-split"><div className="section-title"><span className="section-icon lavender"><Users size={17} /></span><div><h2>Recruiter shortlist</h2><p>Public professional contacts matched to this company and role.</p></div></div><span className="quiet-count">{contacts.length} FOUND</span></div>
                {contacts.length > 0 ? <><div className="data-table"><div className="table-head"><span>CONTACT</span><span>ROLE</span><span>WORK EMAIL</span><span>STATUS</span></div>{contacts.map((contact) => <div className="table-row" key={contact.email}><div className="contact-name"><span className="mini-avatar">{contact.name.slice(0, 1) || "?"}</span><strong>{contact.name || "Name unavailable"}</strong></div><span>{contact.title}</span><span className="email-text">{contact.email}</span><span className={`verification ${contact.verification_status === "valid" ? "verified" : ""}`}>{contact.verification_status}</span></div>)}</div><button className="button-primary button-spaced" disabled={!!busy || !campaign} onClick={addContacts}><Check size={16} />Use up to {Math.min(limit, contacts.length)} contacts</button></> : <div className="empty-panel"><div className="empty-icon"><Users size={20} /></div><strong>Your shortlist will appear here</strong><span>Contact discovery uses public search and professional email sources.</span>{!contacts.length && <button className="button-secondary" disabled={!!busy} onClick={discoverContacts}>{busy === "Finding contacts" ? <LoaderCircle className="animate-spin" size={15} /> : <Search size={15} />}Find recruiters</button>}</div>}
              </section>}
              {campaign && <section className="surface-card drafts-card">
                <div className="section-title section-title-split"><div className="section-title"><span className="section-icon warm"><Mail size={17} /></span><div><h2>Personal email drafts</h2><p>Short, editable, and based on the details you provide.</p></div></div><button className="button-secondary" disabled={!!busy || !campaign.recipients.length} onClick={verifyContacts}>{busy === "Verifying contacts" ? <LoaderCircle className="animate-spin" size={15} /> : <ShieldCheck size={15} />}Verify email addresses</button></div>
                <div className="profile-inline">
                  <label className="input-group"><span>YOUR NAME</span><input className="dark-input" placeholder="Your name" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
                  <label className="input-group"><span>UNIVERSITY</span><input className="dark-input" placeholder="Optional" value={profile.university} onChange={(event) => setProfile({ ...profile, university: event.target.value })} /></label>
                  <label className="input-group"><span>RELEVANT BACKGROUND</span><input className="dark-input" placeholder="A short, accurate summary" value={profile.background} onChange={(event) => setProfile({ ...profile, background: event.target.value })} /></label>
                  <label className="input-group"><span>SKILLS</span><input className="dark-input" placeholder="Python, data analysis…" value={skillText} onChange={(event) => setSkillText(event.target.value)} /></label>
                </div>
                <div className="drafts-toolbar"><span>Template-based drafts · No AI calls</span><button className="button-primary" disabled={!!busy || !campaign.recipients.length || !profile.name.trim()} onClick={generateDrafts}>{busy === "Generating drafts" ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}Generate drafts</button></div>
                {campaign.recipients.map((recipient) => <article className="draft-item" key={recipient.id}><div className="draft-recipient"><span className="mini-avatar">{recipient.recruiter.name.slice(0, 1) || "?"}</span><div><strong>{recipient.recruiter.name}</strong><small>{recipient.recruiter.email}</small></div><span className={`verification ${recipient.recruiter.verification_status === "valid" ? "verified" : ""}`}>{recipient.recruiter.verification_status}</span></div><label className="input-group"><span>SUBJECT</span><input className="dark-input" value={recipient.subject} onChange={(event) => setCampaign({ ...campaign, recipients: campaign.recipients.map((item) => item.id === recipient.id ? { ...item, subject: event.target.value } : item) })} /></label><label className="input-group"><span>MESSAGE</span><textarea className="dark-input draft-body" value={recipient.body} onChange={(event) => setCampaign({ ...campaign, recipients: campaign.recipients.map((item) => item.id === recipient.id ? { ...item, body: event.target.value } : item) })} /></label></article>)}
                {campaign.recipients.length > 0 && <div className="approval-row"><button className="button-primary" disabled={!!busy || campaign.status !== "draft"} onClick={approveCampaign}><Check size={16} />Review & approve</button><span>Every email stays a draft until you approve it.</span></div>}
              </section>}
              <div className="sending-note"><ShieldCheck size={18} /><div><strong>You’re always in control.</strong><span>Google sign-in and account activity are enabled. Gmail sending is not connected yet, so nothing can be sent from this app.</span></div></div>
            </section>
          )}

          {view === "Campaigns" && <CampaignList campaigns={campaigns} onOpen={(id) => void perform("Loading campaign", async () => { const selected = await call<Campaign>(`/api/campaigns/${id}`); setCampaign(selected); setJob(selected.job); setUrl(selected.job?.url || ""); setView("New campaign"); })} onNew={() => { setCampaign(null); setJob(null); setContacts([]); setView("New campaign"); }} />}
          {view === "Email activity" && <ActivityList activity={activity} />}
          {view === "Contacts" && <ContactList campaigns={campaigns} />}
          {view === "My profile" && <ProfileSettings profile={profile} skillText={skillText} setProfile={setProfile} setSkillText={setSkillText} saveProfile={saveProfile} busy={busy} />}
        </div>
      </main>
    </div>
  );
}

function Overview({ analytics, activity, campaigns, onNavigate }: { analytics: Analytics; activity: ActivityItem[]; campaigns: Campaign[]; onNavigate: (view: string) => void }) {
  return <section className="page-section">
    <div className="welcome-banner"><div className="welcome-copy"><div className="eyebrow">YOUR OUTREACH, IN ONE PLACE</div><h1>Good work starts<br />with a <span>good hello.</span></h1><p>Build a thoughtful first touch. Keep every detail and follow-up close at hand.</p><button className="button-primary" onClick={() => onNavigate("New campaign")}><Plus size={16} />Start a campaign<ChevronRight size={16} /></button></div><div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><Command size={30} /></div><div className="orbit-chip chip-one"><Mail size={16} /></div><div className="orbit-chip chip-two"><Users size={16} /></div><div className="orbit-chip chip-three"><Sparkles size={16} /></div><div className="orbit-glow" /></div><div className="banner-caption"><span className="caption-line" /> A little more human, a little less noise</div></div>
    <div className="stats-grid">
      <StatCard label="CAMPAIGNS" value={analytics.campaigns} icon={BriefcaseBusiness} accent="mint" detail="Created in your workspace" />
      <StatCard label="CONTACTS" value={analytics.contacts} icon={Users} accent="lilac" detail="Added to your campaigns" />
      <StatCard label="EMAILS SENT" value={analytics.sent} icon={ArrowUpRight} accent="amber" detail="Gmail connection required" />
      <StatCard label="REPLIES" value={analytics.replies} icon={ArrowDownLeft} accent="blue" detail={`${(analytics.response_rate * 100).toFixed(0)}% response rate`} />
    </div>
    <div className="overview-columns">
      <section className="surface-card overview-card"><div className="card-heading"><div><div className="eyebrow">YOUR WORK</div><h2>Recent campaigns</h2></div><button className="text-button" onClick={() => onNavigate("Campaigns")}>View all <ChevronRight size={14} /></button></div>
        {campaigns.length ? <div className="recent-campaigns">{campaigns.slice(0, 5).map((campaign) => <div className="campaign-row" key={campaign.id}><span className="campaign-icon"><BriefcaseBusiness size={16} /></span><div><strong>{campaign.job?.title || campaign.job?.company || `Campaign #${campaign.id}`}</strong><small>{campaign.recipients.length} of {campaign.requested_count} contacts · {campaign.status}</small></div><span className="row-date">{new Date(campaign.created_at).toLocaleDateString("en", { month: "short", day: "numeric" })}</span></div>)}</div> : <EmptyState icon={BriefcaseBusiness} title="Your first campaign is waiting" copy="Start with a job posting and build a shortlist that feels right." action="Create campaign" onClick={() => onNavigate("New campaign")} />}
      </section>
      <section className="surface-card overview-card"><div className="card-heading"><div><div className="eyebrow">A QUIET PAPER TRAIL</div><h2>Recent activity</h2></div><button className="text-button" onClick={() => onNavigate("Email activity")}>See activity <ChevronRight size={14} /></button></div>
        {activity.length ? <ActivityEntries items={activity.slice(0, 5)} /> : <EmptyState icon={Activity} title="Nothing to catch up on" copy="Your account activity will show up here as you go." />}
      </section>
    </div>
    <div className="bottom-note"><ShieldCheck size={15} /><span>Your account, your data. Campaign history and profile details are saved to your signed-in account.</span><span className="note-divider">·</span><span>Emails are never sent without explicit approval.</span></div>
  </section>;
}

function StatCard({ label, value, icon: Icon, accent, detail }: { label: string; value: number; icon: typeof Users; accent: string; detail: string }) {
  return <article className="stat-card"><div className={`stat-icon ${accent}`}><Icon size={17} /></div><div className="stat-label">{label}</div><div className="stat-value">{value.toLocaleString()}</div><div className="stat-detail">{detail}</div><span className="stat-spark" /></article>;
}

function CampaignList({ campaigns, onOpen, onNew }: { campaigns: Campaign[]; onOpen: (id: number) => void; onNew: () => void }) {
  return <section className="page-section"><div className="page-heading"><div><div className="eyebrow">CAMPAIGN HISTORY</div><h1>Your campaigns</h1><p>Each draft and approval, together in one place.</p></div><button className="button-primary" onClick={onNew}><Plus size={16} />New campaign</button></div><section className="surface-card listing-card">
    {campaigns.length ? <div className="data-table"><div className="table-head campaign-table-head"><span>CAMPAIGN</span><span>CONTACTS</span><span>STATUS</span><span>OPEN</span></div>{campaigns.map((campaign) => <button className="table-row campaign-table-row" key={campaign.id} onClick={() => onOpen(campaign.id)}><div className="contact-name"><span className="campaign-icon"><BriefcaseBusiness size={16} /></span><span><strong>{campaign.job?.title || campaign.job?.company || `Campaign #${campaign.id}`}</strong><small className="campaign-subtitle">{new Date(campaign.created_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</small></span></div><span>{campaign.recipients.length} / {campaign.requested_count}</span><span className="state-pill">{campaign.status}</span><ChevronRight size={16} /></button>)}</div> : <EmptyState icon={BriefcaseBusiness} title="No campaigns yet" copy="Start with a job posting and create a private recruiter shortlist." action="Create your first campaign" onClick={onNew} />}
  </section></section>;
}

function ActivityList({ activity }: { activity: ActivityItem[] }) {
  return <section className="page-section"><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT HISTORY</div><h1>Email activity</h1><p>A private timeline of job analysis, drafts, and campaign decisions.</p></div><div className="activity-count"><Activity size={16} /> {activity.length} EVENTS</div></div><section className="surface-card activity-page">{activity.length ? <ActivityEntries items={activity} /> : <EmptyState icon={Activity} title="Your activity will appear here" copy="Actions in your workspace are saved to your account as you work." />}</section></section>;
}

function ContactList({ campaigns }: { campaigns: Campaign[] }) {
  const contacts = campaigns.flatMap((campaign) => campaign.recipients.map((recipient) => ({ ...recipient.recruiter, status: recipient.status })));
  return <section className="page-section"><div className="page-heading"><div><div className="eyebrow">YOUR SHORTLIST</div><h1>Recruiter contacts</h1><p>Contacts associated with campaigns in your account.</p></div><div className="activity-count"><Users size={16} /> {contacts.length} CONTACTS</div></div><section className="surface-card listing-card">{contacts.length ? <div className="data-table"><div className="table-head"><span>CONTACT</span><span>ROLE</span><span>EMAIL</span><span>STATUS</span></div>{contacts.map((contact, index) => <div className="table-row" key={`${contact.email}-${index}`}><div className="contact-name"><span className="mini-avatar">{contact.name.slice(0, 1) || "?"}</span><strong>{contact.name}</strong></div><span>{contact.title}</span><span className="email-text">{contact.email}</span><span className="state-pill">{contact.status}</span></div>)}</div> : <EmptyState icon={Users} title="Your contact list is empty" copy="Recruiters you add to a campaign will be saved here." />}</section></section>;
}

function ProfileSettings({ profile, skillText, setProfile, setSkillText, saveProfile, busy }: { profile: Profile; skillText: string; setProfile: (profile: Profile) => void; setSkillText: (skills: string) => void; saveProfile: () => void; busy: string }) {
  return <section className="page-section"><div className="page-heading"><div><div className="eyebrow">ABOUT YOU</div><h1>Your personal profile</h1><p>Saved to your account and ready to personalize future drafts.</p></div><span className="activity-count"><ShieldCheck size={16} /> ACCOUNT-SAVED</span></div><section className="surface-card profile-settings"><div className="section-title"><span className="section-icon"><FileUser size={17} /></span><div><h2>Candidate details</h2><p>Only include accurate details you’re comfortable sharing.</p></div></div><div className="profile-form-grid"><label className="input-group"><span>FULL NAME</span><input className="dark-input" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="Your name" /></label><label className="input-group"><span>UNIVERSITY</span><input className="dark-input" value={profile.university} onChange={(event) => setProfile({ ...profile, university: event.target.value })} placeholder="Optional" /></label><label className="input-group input-span-two"><span>RELEVANT BACKGROUND</span><textarea className="dark-input draft-body" value={profile.background} onChange={(event) => setProfile({ ...profile, background: event.target.value })} placeholder="A short summary of your studies or experience" /></label><label className="input-group"><span>SKILLS</span><input className="dark-input" value={skillText} onChange={(event) => setSkillText(event.target.value)} placeholder="Python, product design…" /></label><label className="input-group"><span>PORTFOLIO URL</span><input className="dark-input" type="url" value={profile.portfolio_url || ""} onChange={(event) => setProfile({ ...profile, portfolio_url: event.target.value || null })} placeholder="https://…" /></label></div><button className="button-primary profile-save" disabled={!!busy} onClick={saveProfile}>{busy === "Saving profile" ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />}Save profile</button></section></section>;
}

function ActivityEntries({ items }: { items: ActivityItem[] }) {
  return <div className="activity-entries">{items.map((item) => {
    const Icon = item.type.includes("campaign") ? BriefcaseBusiness : item.type.includes("profile") ? FileUser : item.type.includes("draft") ? Mail : item.type.includes("contacts") ? Users : Search;
    return <div className="activity-entry" key={item.id}><span className="activity-entry-icon"><Icon size={15} /></span><div className="activity-entry-copy"><strong>{item.summary}</strong><small>{item.type.replaceAll("_", " ")}</small></div><span className="activity-time"><Clock3 size={13} />{new Date(item.created_at).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>;
  })}</div>;
}

function EmptyState({ icon: Icon, title, copy, action, onClick }: { icon: typeof Users; title: string; copy: string; action?: string; onClick?: () => void }) {
  return <div className="empty-panel"><div className="empty-icon"><Icon size={20} /></div><strong>{title}</strong><span>{copy}</span>{action && onClick && <button className="button-secondary" onClick={onClick}>{action}<ChevronRight size={14} /></button>}</div>;
}

function GoogleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94a11.05 11.05 0 0 1-4.8 7.24l7.73 5.98c4.51-4.16 7.11-10.29 7.11-17.69Z" transform="translate(0 0)" /><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 0)" /><path fill="#34A853" d="M24 48c6.47 0 11.9-2.13 15.87-5.76l-7.73-5.98c-2.14 1.44-4.88 2.29-8.14 2.29-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" /></svg>;
}
