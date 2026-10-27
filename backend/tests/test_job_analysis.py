import pytest
from fastapi import HTTPException

from app.job_analysis import _validate_public_host, extract_job


def test_extracts_job_posting_json_ld():
    html = """
    <html><head><title>Listing</title>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"JobPosting","title":"Backend Intern",
     "identifier":{"value":"REQ-42"},"description":"Build services with Python and SQL.",
     "hiringOrganization":{"name":"Example Corp","url":"https://example.com"},"jobLocation":{"address":{"addressLocality":"Boston","addressRegion":"MA"}}}
    </script></head><body></body></html>
    """
    result = extract_job("https://jobs.example.com/backend-intern", html)
    assert result["title"] == "Backend Intern"
    assert result["company"] == "Example Corp"
    assert result["location"] == "Boston, MA"
    assert result["job_id"] == "REQ-42"
    assert "Python" in result["requirements"]
    assert result["company_domain"] == "example.com"


def test_does_not_assume_job_board_domain_is_company_domain():
    result = extract_job("https://jobs.example.com/backend-intern", "<html><title>Listing</title><body>Position details</body></html>")
    assert result["company_domain"] is None


def test_rejects_non_https_job_url():
    with pytest.raises(HTTPException) as error:
        _validate_public_host("http://example.com/job")
    assert error.value.status_code == 400


def test_rejects_local_job_host():
    with pytest.raises(HTTPException) as error:
        _validate_public_host("https://localhost/job")
    assert error.value.status_code == 400
