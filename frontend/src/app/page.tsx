"use client";

import { useMemo, useState } from "react";
import { Activity, BriefcaseBusiness, Check, ChevronRight, CircleAlert, LoaderCircle, LockKeyhole, Mail, Search, Send, Settings2, Users } from "lucide-react";

type Job = { id: number; url: string; company?: string; title?: string; location?: string; job_id?: string; description: string; requirements: string[]; cached: boolean };
type Recruiter = { id?: number; name: string; title: string; company: string; email: string; source_url: string; verification_status: string; relevance_score: number };
type Recipient = { id: number; recruiter_id: number; status: string; subject: string; body: string; recruiter: Recruiter };
type Campaign = { id: number; status: string; requested_count: number; recipients: Recipient[] };
type Profile = { name: string; university: string; background: string; skills: string[]; portfolio_url: string | null };

const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Home() {
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(3);
  const [job, setJob] = useState<Job | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<Recruiter[]>([]);
  const [profile, setProfile] = useState<Profile>({ name: "", university: "", background: "", skills: [], portfolio_url: null });
  const [skillText, setSkillText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("New campaign");
  const headers = useMemo(() => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }), [token]);

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  }
  async function perform(label: string, work: () => Promise<void>) {
    setBusy(label); setError(""); setNotice("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong"); }
    finally { setBusy(""); }
  }

  const step = campaign ? campaign.recipients.length ? campaign.recipients.some((r) => r.subject) ? 4 : 3 : 2 : job ? 2 : 1;
  const sentLabel = campaign?.status === "approved" ? "Approved · awaiting Gmail setup" : campaign?.status || "Draft";

  function updateRecipient(id: number, patch: Partial<Recipient>) {
    setCampaign((current) => current ? { ...current, recipients: current.recipients.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
  }
  async function addContacts() {
    if (!campaign) return;
    await perform("Saving contacts", async () => {
      const saved = await call(`/api/campaigns/${campaign.id}/recruiters`, { method: "POST", body: JSON.stringify({ recruiters: contacts.slice(0, limit) }) });
      setCampaign(saved);
      setNotice(`Added ${saved.recipients.length} eligible contact(s).`);
    });
  }
  async function approve() {
    if (!campaign) return;
    await perform("Approving", async () => {
      const saved = await call(`/api/campaigns/${campaign.id}/drafts`, { method: "POST", body: JSON.stringify({ recipients: campaign.recipients.map(({ id, subject, body }) => ({ id, subject, body })) }) });
      setCampaign(saved);
      const updated = await call(`/api/campaigns/${campaign.id}/approve`, { method: "POST" });
      setCampaign(updated);
      setNotice("Campaign approved. Sending is disabled until Gmail and a durable worker are configured.");
    });
  }
  async function verifyContacts() {
    if (!campaign) return;
    await perform("Verifying contacts", async () => {
      await call("/api/recruiters/verify", {
        method: "POST",
        body: JSON.stringify({ recruiter_ids: campaign.recipients.map((item) => item.recruiter_id) }),
      });
      setCampaign(await call(`/api/campaigns/${campaign.id}`));
      setNotice("Contact verification updated by Hunter.io.");
    });
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="flex w-full shrink-0 flex-col border-r border-[#e3e8e4] bg-white p-5 md:sticky md:top-0 md:h-screen md:w-64">
        <div className="mb-9 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#176b4d] text-white"><Mail size={20} /></div><div><div className="font-bold">RecruiterReach</div><div className="text-xs text-gray-500">Private outreach workspace</div></div></div>
        <nav className="grid grid-cols-2 gap-1 md:grid-cols-1">
          {[["Dashboard", Activity], ["New campaign", BriefcaseBusiness], ["Campaigns", Mail], ["Recruiters", Users], ["Email activity", Send], ["Settings", Settings2]].map(([label, Icon]) => {
            const Label = label as string; const Glyph = Icon as typeof Activity;
            return <button key={Label} onClick={() => setView(Label)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${view === Label ? "bg-[#eaf5ef] font-semibold text-[#176b4d]" : "text-gray-600 hover:bg-gray-50"}`}><Glyph size={17} />{Label}</button>;
          })}
        </nav>
        <div className="mt-auto hidden rounded-xl bg-[#f7f8f5] p-3 text-xs leading-5 text-gray-600 md:block"><LockKeyhole size={15} className="mb-2 text-[#176b4d]" /> API access uses a private bearer token. Keep it secret and use HTTPS outside local development.</div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-5 py-8 md:px-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-[.15em] text-[#47836c]">Recruiting, thoughtfully</p><h1 className="text-3xl font-bold tracking-tight">{view === "New campaign" ? "Create an outreach campaign" : view}</h1><p className="mt-2 text-sm text-gray-500">Review every contact and message before any outreach.</p></div>
          <label className="w-full max-w-xs"><span className="mb-1 block text-xs font-medium text-gray-600">Private API access token</span><input aria-label="Private API access token" className="field text-sm" type="password" autoComplete="off" placeholder="Set APP_ACCESS_TOKEN from backend .env" value={token} onChange={(e) => setToken(e.target.value)} /></label>
        </header>
        {error && <div role="alert" className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><CircleAlert size={17} />{error}</div>}
        {notice && <div role="status" className="mb-5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

        {view === "New campaign" ? <>
          <section className="panel mb-6 p-5 md:p-7">
            <div className="mb-6 flex items-center gap-2 text-xs text-gray-500">{["Analyze job", "Find contacts", "Write emails", "Review"].map((item, index) => <span key={item} className={`flex items-center gap-2 ${step >= index + 1 ? "font-semibold text-[#176b4d]" : ""}`}><span className="grid h-6 w-6 place-items-center rounded-full border border-current">{step > index + 1 ? <Check size={14} /> : index + 1}</span><span className="hidden sm:inline">{item}</span>{index < 3 && <ChevronRight size={14} />}</span>)}</div>
            <h2 className="mb-1 text-lg font-semibold">Job details</h2><p className="mb-4 text-sm text-gray-500">Analyze the public posting and confirm extracted details before continuing.</p>
            <div className="grid gap-3 md:grid-cols-[1fr_150px_auto]">
              <input aria-label="Job posting URL" className="field" placeholder="https://company.com/careers/job/..." value={url} onChange={(e) => setUrl(e.target.value)} />
              <input aria-label="Maximum contacts" className="field" type="number" min={1} max={10} value={limit} onChange={(e) => setLimit(Math.min(10, Math.max(1, Number(e.target.value))))} />
              <button className="primary flex items-center justify-center gap-2" disabled={!token || !url || !!busy} onClick={() => perform("Analyzing job", async () => { const result = await call("/api/jobs/analyze", { method: "POST", body: JSON.stringify({ url }) }); setJob(result); setCampaign(null); setContacts([]); })}>{busy === "Analyzing job" ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}Analyze</button>
            </div>
            <p className="mt-2 text-xs text-gray-400">Maximum contacts per campaign: 10. Only public HTTPS pages are supported.</p>
            {job && <div className="mt-5 rounded-xl border border-[#dce9e0] bg-[#f8fcf9] p-4"><div className="flex flex-wrap justify-between gap-2"><div><div className="font-semibold">{job.title || "Title not detected"}{job.company ? ` · ${job.company}` : ""}</div><div className="mt-1 text-sm text-gray-500">{job.location || "Location not detected"} · {job.cached ? "Loaded from cache" : "Analyzed now"}</div></div><span className="h-fit rounded-full bg-[#eaf5ef] px-3 py-1 text-xs text-[#176b4d]">{job.requirements.length ? job.requirements.join(", ") : "No skills detected"}</span></div><p className="mt-3 line-clamp-3 text-sm text-gray-600">{job.description}</p></div>}
          </section>

          {job && <section className="panel mb-6 p-5 md:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Recruiter discovery</h2><p className="mt-1 text-sm text-gray-500">Searches public results and Hunter.io. Contacts are never invented.</p></div><button className="primary flex items-center gap-2" disabled={!token || !!busy} onClick={() => perform("Finding contacts", async () => { const created = campaign || await call("/api/campaigns", { method: "POST", body: JSON.stringify({ job_id: job.id, requested_count: limit }) }); setCampaign(created); const found = await call(`/api/recruiters/discover?job_id=${job.id}`, { method: "POST" }); setContacts(found.recruiters); if (!found.recruiters.length) setNotice("No matching verified recruiter contacts found."); })}>{busy === "Finding contacts" ? <LoaderCircle className="animate-spin" size={16} /> : <Users size={16} />}Discover recruiters</button></div>
            {contacts.length > 0 && <><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b text-xs uppercase text-gray-500"><tr><th className="py-3">Name</th><th>Title</th><th>Email</th><th>Verification</th></tr></thead><tbody>{contacts.map((contact, i) => <tr key={contact.email} className="border-b last:border-0"><td className="py-3 font-medium">{contact.name || "Name unavailable"}</td><td>{contact.title}</td><td>{contact.email}</td><td><span className={`rounded-full px-2 py-1 text-xs ${contact.verification_status === "valid" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{contact.verification_status}</span></td></tr>)}</tbody></table></div><button className="primary mt-4" disabled={!!busy} onClick={addContacts}>Use {Math.min(limit, contacts.length)} contacts</button></>}</section>}

          {campaign && <section className="panel mb-6 p-5 md:p-7">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Email drafts</h2><p className="mt-1 text-sm text-gray-500">Edit all drafts. AI is not used in this initial version; messages are generated from a deterministic template.</p></div><button className="primary" disabled={!token || !campaign.recipients.length || !!busy} onClick={() => perform("Generating drafts", async () => { const generated = await call(`/api/campaigns/${campaign.id}/generate`, { method: "POST", body: JSON.stringify({ profile: { ...profile, skills: skillText.split(",").map((s) => s.trim()).filter(Boolean) } }) }); setCampaign(generated); })}>{busy === "Generating drafts" ? "Generating…" : "Generate drafts"}</button></div>
            <button className="mb-4 rounded-lg border border-[#176b4d] px-3 py-2 text-sm font-medium text-[#176b4d]" disabled={!token || !campaign.recipients.length || campaign.status !== "draft" || !!busy} onClick={verifyContacts}>{busy === "Verifying contacts" ? "Verifying…" : "Verify contact emails"}</button>
            <div className="mb-5 grid gap-3 sm:grid-cols-2"><input className="field" aria-label="Your name" placeholder="Your name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /><input className="field" aria-label="University" placeholder="University (optional)" value={profile.university} onChange={(e) => setProfile({ ...profile, university: e.target.value })} /><input className="field" aria-label="Relevant background" placeholder="Relevant background" value={profile.background} onChange={(e) => setProfile({ ...profile, background: e.target.value })} /><input className="field" aria-label="Skills" placeholder="Relevant skills, comma-separated" value={skillText} onChange={(e) => setSkillText(e.target.value)} /></div>
            {campaign.recipients.map((item) => <article key={item.id} className="mb-4 rounded-xl border border-gray-200 p-4 last:mb-0"><div className="mb-3 flex flex-wrap justify-between gap-2"><div className="font-semibold">{item.recruiter.name} <span className="font-normal text-gray-500">· {item.recruiter.email}</span></div><span className="text-xs text-gray-500">{item.recruiter.verification_status}</span></div><input className="field mb-2" aria-label={`Subject for ${item.recruiter.email}`} placeholder="Subject" value={item.subject} onChange={(e) => updateRecipient(item.id, { subject: e.target.value })} /><textarea className="field min-h-36 resize-y" aria-label={`Message for ${item.recruiter.email}`} placeholder="Message body" value={item.body} onChange={(e) => updateRecipient(item.id, { body: e.target.value })} /></article>)}
            {!!campaign.recipients.length && <div className="mt-5 flex flex-wrap items-center gap-3"><button className="primary flex items-center gap-2" disabled={!token || campaign.status !== "draft" || !!busy} onClick={approve}><Check size={16} />Approve campaign</button><span className="text-sm text-gray-500">Status: {sentLabel}</span></div>}
          </section>}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><strong>Sending is intentionally unavailable.</strong> This foundation does not connect to Gmail or run a durable sending worker, so campaign launch will not send or queue email. Configure a reviewed Gmail OAuth/sending integration before real outreach.</div>
        </> : <section className="panel p-8"><h2 className="text-lg font-semibold">{view}</h2><p className="mt-2 text-sm text-gray-500">This workspace view is not available in this initial build. Start a new campaign to use the implemented workflow.</p></section>}
      </main>
    </div>
  );
}
