import ipaddress
import json
import socket
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException

from app.config import settings


def _validate_public_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Only public HTTPS job URLs are supported")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="Job host could not be resolved") from exc
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address[4][0])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Job host resolved to an invalid network address") from exc
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="Private and local network addresses are not allowed")


async def fetch_public_page(url: str) -> str:
    current = url
    checked_robots: dict[str, RobotFileParser | None] = {}
    async with httpx.AsyncClient(timeout=12, follow_redirects=False, headers={"User-Agent": "RecruiterReach/1.0"}) as client:
        for _ in range(4):
            _validate_public_host(current)
            parsed = urlparse(current)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            if origin not in checked_robots:
                try:
                    robots_response = await client.get(f"{origin}/robots.txt")
                except httpx.HTTPError as exc:
                    raise HTTPException(status_code=502, detail="Could not check the site's robots.txt policy") from exc
                if robots_response.status_code in {404, 410}:
                    checked_robots[origin] = None
                elif robots_response.status_code == 200 and len(robots_response.content) <= 100_000:
                    parser = RobotFileParser()
                    parser.set_url(f"{origin}/robots.txt")
                    parser.parse(robots_response.text.splitlines())
                    checked_robots[origin] = parser
                else:
                    raise HTTPException(status_code=403, detail="Could not confirm permission from the site's robots.txt policy")
            robots = checked_robots[origin]
            if robots and not robots.can_fetch("RecruiterReach/1.0", current):
                raise HTTPException(status_code=403, detail="The site's robots.txt policy disallows fetching this URL")
            try:
                async with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(status_code=502, detail="Job page returned an invalid redirect")
                        next_url = urljoin(current, location)
                    else:
                        if response.status_code >= 400:
                            raise HTTPException(status_code=502, detail=f"Job page returned HTTP {response.status_code}")
                        length = response.headers.get("content-length")
                        if length:
                            try:
                                declared_size = int(length)
                            except ValueError:
                                declared_size = 0
                            if declared_size > settings.max_job_page_bytes:
                                raise HTTPException(status_code=413, detail="Job page exceeds the configured size limit")
                        chunks = []
                        size = 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > settings.max_job_page_bytes:
                                raise HTTPException(status_code=413, detail="Job page exceeds the configured size limit")
                            chunks.append(chunk)
                        return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="Could not fetch the job posting") from exc
            current = next_url
    raise HTTPException(status_code=400, detail="Job page redirected too many times")


def extract_job(url: str, html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else None
    description_parts: list[str] = []
    job_data: dict = {}
    for element in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(element.string or element.get_text())
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            graph = candidate.get("@graph", [])
            candidates.extend(item for item in graph if isinstance(item, dict))
            kind = candidate.get("@type", [])
            if "JobPosting" in (kind if isinstance(kind, list) else [kind]):
                job_data = candidate
                break
        if job_data:
            break
    if job_data:
        title = job_data.get("title") or title
        organization = job_data.get("hiringOrganization") or {}
        company = organization.get("name") if isinstance(organization, dict) else None
        organization_url = organization.get("url") if isinstance(organization, dict) else None
        organization_host = urlparse(organization_url).hostname if isinstance(organization_url, str) else None
        company_domain = organization_host.removeprefix("www.") if organization_host else None
        location_data = job_data.get("jobLocation") or {}
        if isinstance(location_data, list):
            location_data = location_data[0] if location_data else {}
        address = location_data.get("address", {}) if isinstance(location_data, dict) else {}
        location = ", ".join(filter(None, [address.get("addressLocality"), address.get("addressRegion"), address.get("addressCountry")])) or None
        description = BeautifulSoup(job_data.get("description", ""), "html.parser").get_text(" ", strip=True)
        job_id = job_data.get("identifier")
        if isinstance(job_id, dict):
            job_id = job_id.get("value")
        if description:
            description_parts.append(description[:12000])
    else:
        company = None
        company_domain = None
        location = None
        job_id = None
        description = ""
        main = soup.find("main") or soup.body or soup
        description = main.get_text(" ", strip=True)[:12000]
        if description:
            description_parts.append(description)
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    if not description_parts:
        description_parts.append((soup.find("main") or soup.body or soup).get_text(" ", strip=True)[:12000])
    requirements = sorted({word for word in ("Python", "Java", "TypeScript", "JavaScript", "React", "SQL", "AWS", "Azure", "C++", "Go", "Kubernetes", "Machine Learning") if word.lower() in description_parts[0].lower()})
    return {"title": title, "company": company, "location": location, "job_id": str(job_id) if job_id else None, "description": description_parts[0], "company_domain": company_domain, "requirements": requirements}
