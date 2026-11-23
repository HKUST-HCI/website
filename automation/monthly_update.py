#!/usr/bin/env python3
"""Monthly HCI Initiative content scraper and human-review workflow.

The script stages remote content only. Existing site files are never changed
automatically. A reviewer must approve a staged batch before approved JSON and
an append-only audit record are written.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import hashlib
import html
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.resolve()
SITE_ROOT = (PROJECT_ROOT / "build").resolve()
DEFAULT_CONFIG = ROOT / "config.json"
REVIEW_PAGE = ROOT / "review.html"
USER_AGENT = "HKUST-HCI-Initiative-content-review/1.0"


def sync_and_build_site() -> None:
    """Move approved records into Mustache data, then rebuild the site."""
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    subprocess.run([npm, "run", "sync:approved"], cwd=PROJECT_ROOT, check=True)
    subprocess.run([npm, "run", "build"], cwd=PROJECT_ROOT, check=True)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def fetch(url: str, timeout: int) -> str:
    for attempt in range(5):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, errors="replace")
        except (OSError, urllib.error.URLError, TimeoutError):
            if attempt == 4:
                raise
            time.sleep(2**attempt)
    raise RuntimeError(f"Unable to fetch {url}")


def download_file(url: str, target: Path, timeout: int) -> tuple[bool, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content = response.read()
        if not content:
            return False, "empty response"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return True, ""
    except (OSError, urllib.error.URLError, TimeoutError) as error:
        return False, str(error)


def download_publication_images(timeout: int) -> Path:
    html_path = ROOT.parent / "publications.html"
    image_dir = ROOT.parent / "img" / "publications"
    source = html_path.read_text(encoding="utf-8")
    urls = sorted(set(
        match.group(1)
        for match in re.finditer(r'<img src="(https?://[^"]+)"', source)
    ))
    report: dict[str, Any] = {
        "startedAt": now_iso(),
        "sourceFile": str(html_path),
        "attempted": len(urls),
        "downloaded": [],
        "failed": []
    }
    for url in urls:
        parsed = urllib.parse.urlparse(url)
        filename = Path(parsed.path).name or "publication-image"
        if filename in {"publication-image", "."}:
            filename = f"publication-image-{hashlib.sha1(url.encode()).hexdigest()[:10]}.bin"
        target = image_dir / filename
        ok, error = download_file(url, target, timeout)
        if ok:
            local_path = "img/publications/" + filename
            source = source.replace(url, local_path)
            report["downloaded"].append({"url": url, "path": local_path})
        else:
            report["failed"].append({"url": url, "error": error})
    if report["downloaded"]:
        html_path.write_text(source, encoding="utf-8")
    report["finishedAt"] = now_iso()
    report_path = ROOT / "data" / "image-download-report.json"
    write_json(report_path, report)
    print(f"Publication images downloaded: {len(report['downloaded'])}/{report['attempted']}.")
    if report["failed"]:
        print(f"Image downloads failed: {len(report['failed'])}. See {report_path}")
    return report_path


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def escape_html_ascii(value: Any, quote: bool = False) -> str:
    """Escape text and serialize non-ASCII characters as stable HTML entities."""
    escaped = html.escape(str(value), quote=quote)
    return escaped.encode("ascii", errors="xmlcharrefreplace").decode("ascii")


def venue_is_incomplete(value: Any, title: Any = "") -> bool:
    venue = clean_text(str(value or ""))
    title_key = content_key(str(title or ""))
    venue_key = content_key(venue)
    repeats_title = bool(title_key and venue_key.startswith(title_key))
    return not venue or "…" in venue or "..." in venue or repeats_title


def publication_venue_for_display(value: Any, title: Any = "") -> str:
    venue = clean_text(str(value or ""))
    return "Publication details pending verification" if venue_is_incomplete(venue, title) else venue


def content_key(value: str) -> str:
    """Create a stable comparison key for scraped text."""
    return re.sub(r"[^a-z0-9]+", " ", clean_text(value).casefold()).strip()


def news_key(item: dict[str, Any]) -> str:
    return f"{content_key(str(item.get('time', '')))}|{content_key(str(item.get('content', '')))}"


def publication_key(item: dict[str, Any]) -> str:
    return "|".join(
        [
            str(item.get("year", "")),
            content_key(str(item.get("title", ""))),
            content_key(str(item.get("authorLine", ""))),
        ]
    )


def publication_doi(item: dict[str, Any]) -> str:
    links = item.get("links") or {}
    for value in (item.get("doi"), links.get("doi"), item.get("publicationUrl"), links.get("url"), item.get("url")):
        doi = urllib.parse.unquote(str(value or "").strip()).lower()
        doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", doi)
        if re.fullmatch(r"10\.\d{4,9}/\S+", doi):
            return doi
    return ""


def same_publication(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_doi, right_doi = publication_doi(left), publication_doi(right)
    if left_doi and right_doi:
        return left_doi == right_doi
    left_title = re.sub(r"[\W_]+", " ", str(left.get("title") or "").lower()).strip()
    right_title = re.sub(r"[\W_]+", " ", str(right.get("title") or "").lower()).strip()
    return bool(left_title) and left_title == right_title and str(left.get("year", "")).strip() == str(right.get("year", "")).strip()


def merge_publication_fields(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    for key, value in incoming.items():
        if value is None or value == "" or value == [] or value == {}:
            continue
        if key == "links" and isinstance(value, dict):
            merged[key] = {
                **(merged.get(key) or {}),
                **{name: link for name, link in value.items() if link},
            }
        else:
            merged[key] = value
    return merged


def merge_approved_publications(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = [dict(item) for item in existing]
    for item in incoming:
        index = next((i for i, old in enumerate(merged) if same_publication(old, item)), None)
        if index is None:
            merged.append(dict(item))
        else:
            merged[index] = merge_publication_fields(merged[index], item)
    return merged


def filter_incremental_publications(
    scraped: list[dict[str, Any]],
    approved: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    existing = {publication_key(item) for item in approved}
    unique: list[dict[str, Any]] = []
    seen = set(existing)
    removed = 0
    for item in scraped:
        key = publication_key(item)
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        unique.append(item)
    return unique, removed


def filter_news_after_published_anchor(
    scraped: list[dict[str, Any]],
    approved: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, bool]:
    """Keep only source items that appear before the newest published News anchor."""
    content_items = [item for item in scraped if not item.get("systemNotice")]
    approved_keys = {
        news_key(item) for item in approved if not item.get("systemNotice")
    }
    if not approved_keys:
        return [], len(content_items), False
    anchor_index = next(
        (index for index, item in enumerate(content_items) if news_key(item) in approved_keys),
        None,
    )
    if anchor_index is None:
        return [], len(content_items), False
    return content_items[:anchor_index], len(content_items) - anchor_index, True


def filter_publications_after_published_anchor(
    scraped: list[dict[str, Any]],
    approved: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int, bool]:
    """Keep only Scholar rows before the newest publication already on the site."""
    approved_titles = {
        content_key(str(item.get("title", ""))) for item in approved
        if item.get("title")
    }
    if not approved_titles:
        return [], len(scraped), False
    anchor_index = next(
        (
            index for index, item in enumerate(scraped)
            if content_key(str(item.get("title", ""))) in approved_titles
        ),
        None,
    )
    if anchor_index is None:
        return [], len(scraped), False
    candidates = scraped[:anchor_index]
    return filter_incremental_publications(candidates, approved)[0], len(scraped) - anchor_index, True


def parse_news_month(value: str) -> dt.date | None:
    for pattern in ("%b %Y", "%B %Y"):
        try:
            return dt.datetime.strptime(value.strip(), pattern).date().replace(day=1)
        except ValueError:
            continue
    return None


def validate_incremental_snapshot(data_dir: Path, cutoff: dt.date) -> Path:
    approved_news = load_json(data_dir / "approved-news.json", {}).get("items", [])
    approved_publications = load_json(data_dir / "approved-publications.json", {}).get("items", [])
    new_news = [
        item for item in approved_news
        if (item_date := parse_news_month(str(item.get("time", "")))) and item_date > cutoff
    ]
    baseline_publications = [
        item for item in approved_publications
        if int(item.get("year", 0)) <= cutoff.year - 1
    ]
    new_publications, removed_publications = filter_incremental_publications(
        approved_publications,
        baseline_publications,
    )
    snapshot = {
        "mode": "validation-only",
        "assumption": f"Records through {cutoff.isoformat()} are already updated.",
        "cutoff": cutoff.isoformat(),
        "news": new_news,
        "publications": new_publications,
        "stats": {
            "newsExistingThroughCutoff": len(approved_news) - len(new_news),
            "newsNewAfterCutoff": len(new_news),
            "publicationsExistingThroughCutoff": len(baseline_publications),
            "publicationsNewAfterCutoff": len(new_publications),
            "publicationDuplicatesRemoved": removed_publications,
        },
    }
    output = data_dir / "incremental-validation.json"
    write_json(output, snapshot)
    print(f"Validation snapshot: {output}")
    print(json.dumps(snapshot["stats"], ensure_ascii=False))
    return output


def create_incremental_review(data_dir: Path, cutoff: dt.date, people_path: Path) -> Path:
    snapshot = load_json(data_dir / "incremental-validation.json", {})
    current_people = load_current_people(people_path)
    news = annotate_news_matches(snapshot.get("news", []), current_people)
    publications = snapshot.get("publications", [])
    batch = {
        "batchId": dt.datetime.now().strftime("%Y%m%d-%H%M%S"),
        "createdAt": now_iso(),
        "mode": "validation-only",
        "assumption": f"Records through {cutoff.isoformat()} are already updated.",
        "sourceUrl": "validation snapshot",
        "currentMemberCount": len(current_people),
        "currentMembers": [person["name"] for person in current_people],
        "publicationEligibleMembers": load_current_member_names(people_path),
        "scholarStats": {},
        "pages": {},
        "news": [
            {**item, "decision": "pending" if item.get("memberMatchStatus") == "accepted" else "excluded"}
            for item in news
        ],
        "newsStats": {
            "scraped": len(news),
            "removedWithinBatch": 0,
            "removedFromApprovedHistory": snapshot.get("stats", {}).get("newsExistingThroughCutoff", 0),
        },
        "publicationStats": {
            "scraped": len(publications),
            "removedFromApprovedHistory": snapshot.get("stats", {}).get("publicationDuplicatesRemoved", 0),
        },
        "publications": [
            {**item, "decision": "pending"}
            for item in publications
        ],
    }
    output = data_dir / "review.json"
    write_json(output, batch)
    print(f"Validation review batch: {output}")
    print(f"News staged: {len(news)}; Publications staged: {len(publications)}.")
    return output


def deduplicate_news(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    unique: list[dict[str, Any]] = []
    seen: set[str] = set()
    duplicates = 0
    for item in items:
        key = news_key(item)
        if not key or key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique.append(item)
    return unique, duplicates


def render_news_html(items: list[dict[str, Any]]) -> str:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        match = re.search(r"\b(20\d{2})\b", str(item.get("time", "")))
        if not match:
            continue
        grouped.setdefault(int(match.group(1)), []).append(item)
    blocks = []
    for year in sorted(grouped, reverse=True):
        entries = []
        for item in grouped[year]:
            time = escape_html_ascii(item.get("time", ""))
            content = escape_html_ascii(clean_text(str(item.get("content", ""))))
            entries.append(f'                                <p class="mt-2"><strong>[{time}]</strong> {content}</p>')
        blocks.append(
            f'                        <details class="news-year"{ " open" if year == max(grouped) else "" }>\n'
            f'                            <summary><span>{year}</span><small>{len(entries)} updates</small></summary>\n'
            f'                            <div class="news-year-items">\n'
            + "\n".join(entries)
            + '\n                            </div>\n                        </details>'
        )
    return "\n".join(blocks)


def replace_recent_news_page(items: list[dict[str, Any]]) -> None:
    page_path = ROOT.parent / "advanced.html"
    source = page_path.read_text(encoding="utf-8")
    start_marker = '<div id="recent-news" class="text-base news-years">'
    start = source.find(start_marker)
    if start < 0:
        raise ValueError(f"Could not find Recent News container in {page_path}")
    depth = 0
    end = -1
    for match in re.finditer(r"<div\b|</div>", source[start:]):
        token = match.group(0)
        depth += 1 if token.startswith("<div") else -1
        if depth == 0:
            end = start + match.end()
            break
    if end < 0:
        raise ValueError(f"Could not find end of Recent News container in {page_path}")
    replacement = start_marker + "\n" + render_news_html(items) + "\n                    </div>"
    with page_path.open("w", encoding="utf-8", newline="\n") as file:
        file.write(source[:start] + replacement + source[end:])


class PageParser:
    """Small dependency-free parser for the common lab-site HTML patterns."""

    def __init__(self) -> None:
        self.links: list[tuple[str, str]] = []
        self.headings: list[str] = []
        self.paragraphs: list[str] = []
        self._tag = ""
        self._buffer: list[str] = []
        self._attrs: dict[str, str] = {}

    def feed(self, source: str) -> None:
        from html.parser import HTMLParser

        parser = _HTMLParserAdapter(self)
        parser.feed(source)


class _HTMLParserAdapter(__import__("html.parser", fromlist=["HTMLParser"]).HTMLParser):
    def __init__(self, owner: PageParser) -> None:
        super().__init__(convert_charrefs=True)
        self.owner = owner

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        owner = self.owner
        owner._tag = tag.lower()
        owner._attrs = {key: value or "" for key, value in attrs}
        if owner._tag in {"h1", "h2", "h3", "h4", "p", "article", "li"}:
            owner._buffer = []

    def handle_data(self, data: str) -> None:
        if self.owner._tag in {"h1", "h2", "h3", "h4", "p", "article", "li", "a"}:
            self.owner._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        owner = self.owner
        text = clean_text(" ".join(owner._buffer))
        if tag.lower() == "a" and text and owner._attrs.get("href"):
            owner.links.append((text, owner._attrs["href"]))
        if tag.lower() in {"h1", "h2", "h3", "h4"} and text:
            owner.headings.append(text)
        if tag.lower() in {"p", "article", "li"} and text:
            owner.paragraphs.append(text)
        if tag.lower() == owner._tag:
            owner._buffer = []
            owner._tag = ""


def resolve_url(base: str, href: str) -> str:
    return urllib.parse.urljoin(base, href)


def same_origin(base: str, candidate: str) -> bool:
    return urllib.parse.urlparse(base).netloc == urllib.parse.urlparse(candidate).netloc


def candidate_pages(source_url: str, source_html: str) -> dict[str, str]:
    parser = PageParser()
    parser.feed(source_html)
    pages = {"home": source_url}
    for label, href in parser.links:
        url = resolve_url(source_url, href)
        if not same_origin(source_url, url):
            continue
        key = f"{label} {href}".lower()
        if "publication" in key or "news" in key:
            pages["publications" if "publication" in key else "news"] = url
    if "news" not in pages and re.search(r"recent\s+news", source_html, re.I):
        pages["news"] = source_url
    publication_href = re.search(
        r'<a\b[^>]*href=["\']([^"\']*publications?\.html[^"\']*)["\']',
        source_html,
        flags=re.I,
    )
    if "publications" not in pages and publication_href:
        pages["publications"] = resolve_url(source_url, html.unescape(publication_href.group(1)))
    if "publications" not in pages and re.search(r"id=[\"']publication[\"']", source_html, re.I):
        pages["publications"] = source_url
    students_href = re.search(
        r'<a\b[^>]*href=["\']([^"\']*students?\.html[^"\']*)["\']',
        source_html,
        flags=re.I,
    )
    if students_href:
        pages["students"] = resolve_url(source_url, html.unescape(students_href.group(1)))
    return pages


def load_people_names(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    names = re.findall(r'data-name="([^"]+)"', source)
    if not names:
        raise ValueError(f"No People names found in {path}")
    return sorted(set(names))


def load_current_people(path: Path) -> list[dict[str, str]]:
    """Read current members from the site's source data, independent of page layout."""
    groups = load_json(path, None)
    if not isinstance(groups, list):
        raise ValueError(f"Expected a People JSON list in {path}")
    current_groups = [
        group for group in groups
        if isinstance(group, dict)
        and str(group.get("type", "")).strip().casefold() == "current members"
    ]
    if not current_groups:
        raise ValueError(f"No Current Members group found in {path}")
    people = []
    for group in current_groups:
        members = group.get("members")
        if not isinstance(members, list):
            raise ValueError(f"Invalid Current Members list in {path}")
        for person in members:
            if not isinstance(person, dict):
                raise ValueError(f"Invalid current member in {path}")
            name = clean_text(str(person.get("name") or ""))
            position = clean_text(str(person.get("position") or ""))
            if not name or not position:
                raise ValueError(f"Current members require a name and position in {path}")
            people.append({"name": name, "position": position})
    if not people:
        raise ValueError(f"No people found in Current Members group in {path}")
    return sorted(people, key=lambda person: person["name"].casefold())


def load_current_member_names(path: Path) -> list[str]:
    eligible = [
        person["name"]
        for person in load_current_people(path)
        if re.search(r"\b(?:phd|mphil|postdoc)\b", person["position"], flags=re.I)
    ]
    if not eligible:
        raise ValueError(f"No eligible PhD, MPhil, or Postdoc members found in {path}")
    return sorted(set(eligible))


def normalize_match_text(value: str) -> str:
    value = html.unescape(clean_text(value)).casefold()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def news_member_matches(content: str, people: list[dict[str, str]]) -> list[dict[str, str]]:
    """Match explicit current-member references without trusting the source owner."""
    normalized = f" {normalize_match_text(content)} "
    first_name_counts: dict[str, int] = {}
    surname_counts: dict[str, int] = {}
    for person in people:
        parts = normalize_match_text(person["name"]).split()
        if not parts:
            continue
        first_name_counts[parts[0]] = first_name_counts.get(parts[0], 0) + 1
        surname_counts[parts[-1]] = surname_counts.get(parts[-1], 0) + 1

    matches: list[dict[str, str]] = []
    for person in people:
        parts = normalize_match_text(person["name"]).split()
        if not parts:
            continue
        full_name = " ".join(parts)
        evidence = ""
        if f" {full_name} " in normalized:
            evidence = person["name"]
        else:
            first_name = parts[0]
            if len(first_name) >= 4 and first_name_counts.get(first_name) == 1 and f" {first_name} " in normalized:
                evidence = first_name
            surname = parts[-1]
            is_faculty = bool(re.search(r"\b(?:professor|faculty)\b", person["position"], flags=re.I))
            if (
                not evidence
                and is_faculty
                and surname_counts.get(surname) == 1
                and (f" prof {surname} " in normalized or f" professor {surname} " in normalized)
            ):
                evidence = f"Prof. {surname.title()}"
        if evidence:
            matches.append({"name": person["name"], "evidence": evidence})
    return matches


def annotate_news_matches(
    items: list[dict[str, Any]], people: list[dict[str, str]]
) -> list[dict[str, Any]]:
    annotated = []
    for item in items:
        copy = dict(item)
        if copy.get("systemNotice"):
            copy["memberMatchStatus"] = "system"
            copy["matchedMembers"] = []
            copy["matchEvidence"] = []
        else:
            matches = news_member_matches(str(copy.get("content", "")), people)
            copy["matchedMembers"] = [match["name"] for match in matches]
            copy["matchEvidence"] = [match["evidence"] for match in matches]
            copy["memberMatchStatus"] = "accepted" if matches else "not_found"
            if not matches:
                copy["decision"] = "excluded"
        annotated.append(copy)
    return annotated


def first_author_status(author_line: str, people: list[str]) -> tuple[str, str | None]:
    first = clean_text(author_line.split(",", 1)[0]).lower()
    first_surname = re.sub(r"[^a-z-]", "", first.split()[-1])
    matches = [
        name for name in people
        if re.sub(r"[^a-z-]", "", name.split()[-1].lower()) == first_surname
    ]
    if len(matches) == 1:
        return "accepted", matches[0]
    if len(matches) > 1:
        return "ambiguous", ", ".join(matches)
    return "not_found", None


def has_xiaojuan_ma(author_line: str) -> bool:
    normalized = re.sub(r"[^a-z]+", " ", clean_text(author_line).casefold()).strip()
    return bool(
        re.search(r"\bxiaojuan ma\b", normalized)
        or re.search(r"\bma x\b", normalized)
        or re.search(r"\bma xiaojuan\b", normalized)
    )


def extract_member_publications(member_url: str, member_name: str, source_html: str) -> list[dict[str, Any]]:
    blocks = re.findall(
        r"<(?:article|div)\b[^>]*class=[\"'][^\"']*(?:publication|paper)[^\"']*[\"'][^>]*>(.*?)(?:</article>|</div>)",
        source_html,
        flags=re.I | re.S,
    )
    blocks.extend(re.findall(
        r"<li\b[^>]*class=[\"'][^\"']*pub-item[^\"']*[\"'][^>]*>(.*?)</li>",
        source_html,
        flags=re.I | re.S,
    ))
    if not blocks:
        blocks = re.findall(r"<article\b[^>]*>(.*?)</article>", source_html, flags=re.I | re.S)
    items: list[dict[str, Any]] = []
    for index, block in enumerate(blocks):
        if not has_xiaojuan_ma(clean_text(re.sub(r"<[^>]+>", " ", block))):
            continue
        title_match = re.search(
            r"<(?:h[1-4]|div)\b[^>]*class=[\"'][^\"']*(?:pub-title|publication-title)[^\"']*[\"'][^>]*>(.*?)</(?:h[1-4]|div)>",
            block,
            flags=re.I | re.S,
        ) or re.search(r"<h[1-4]\b[^>]*>(.*?)</h[1-4]>", block, flags=re.I | re.S)
        title = clean_text(re.sub(r"<[^>]+>", " ", title_match.group(1))) if title_match else ""
        if not title:
            continue
        author_candidates: list[str] = []
        author_region = re.search(
            r"class=[\"'][^\"']*(?:pub-authors|publication-authors)[^\"']*[\"'][^>]*>(.*?)(?=class=[\"'][^\"']*(?:pub-row|pub-venue|pub-links)[^\"']|</p>\s*<a\b[^>]*class=[\"'][^\"']*paper-link)",
            block,
            flags=re.I | re.S,
        )
        if author_region:
            author_candidates.append(clean_text(re.sub(r"<[^>]+>", " ", author_region.group(1))))
        if not author_candidates:
            author_candidates = [
                clean_text(re.sub(r"<[^>]+>", " ", value))
                for value in re.findall(r"<p\b[^>]*>(.*?)</p>", block, flags=re.I | re.S)
            ]
        author_line = next((value for value in author_candidates if has_xiaojuan_ma(value)), "")
        if not author_line:
            author_start = re.search(r"pub-authors|publication-authors", block, flags=re.I)
            if author_start:
                remainder = block[author_start.start():]
                author_end = re.search(r"pub-row|pub-venue|pub-links", remainder, flags=re.I)
                region = remainder[:author_end.start()] if author_end else remainder
                candidate = clean_text(re.sub(r"<[^>]+>", " ", region.split(">", 1)[-1]))
                candidate = clean_text(re.sub(r"<div\s+class=.*$", "", candidate))
                if has_xiaojuan_ma(candidate):
                    author_line = candidate
        if not author_line:
            full_block_text = clean_text(re.sub(r"<[^>]+>", " ", block))
            if has_xiaojuan_ma(full_block_text):
                author_line = full_block_text
        if not author_line:
            continue
        block_text = clean_text(re.sub(r"<[^>]+>", " ", block))
        year_match = re.search(r"\b(20(?:25|26))\b", block_text)
        if not year_match:
            short_year = re.search(r"['’](25|26)\b", block_text)
            if short_year:
                year_match = short_year
        if not year_match:
            continue
        href_match = re.search(r'<a\b[^>]*href=["\']([^"\']+)["\']', block, flags=re.I)
        items.append({
            "id": f"{member_name.casefold().replace(' ', '-')}-publication-{index + 1}",
            "year": int(year_match.group(1)) if len(year_match.group(1)) == 4 else 2000 + int(year_match.group(1)),
            "title": title,
            "authorLine": author_line,
            "venue": clean_text(re.sub(r"<[^>]+>", " ", block)),
            "url": resolve_url(member_url, html.unescape(href_match.group(1))) if href_match else "",
            "sourceUrl": member_url,
            "memberName": member_name,
            "authorMatch": "Xiaojuan Ma",
            "authorMatchStatus": "accepted",
            "decision": "pending",
        })
    return items


def scrape_current_member_publications(
    students_url: str,
    students_html: str,
    timeout: int,
) -> tuple[list[dict[str, Any]], list[str]]:
    current_section = re.search(
        r"Current members.*?(?=\b(?:Former members|Alumni)\b|</ul>)",
        students_html,
        flags=re.I | re.S,
    )
    if not current_section:
        raise ValueError("Could not find Current members on the Students page.")
    members = re.findall(
        r"<li>\s*<a href=[\"']([^\"']*)[\"']>([^<]+)</a>",
        current_section.group(0),
        flags=re.I,
    )
    items: list[dict[str, Any]] = []
    current_member_names: list[str] = []
    for href, raw_name in members:
        name = clean_text(raw_name)
        current_member_names.append(name)
        if not href:
            continue
        member_url = resolve_url(students_url, html.unescape(href))
        try:
            member_html = fetch(member_url, timeout)
        except (OSError, urllib.error.URLError, TimeoutError):
            continue
        items.extend(extract_member_publications(member_url, name, member_html))
    return items, current_member_names


def extract_current_members(students_html: str) -> list[str]:
    current_section = re.search(
        r"Current members.*?(?=\b(?:Former members|Alumni)\b|</ul>)",
        students_html,
        flags=re.I | re.S,
    )
    if not current_section:
        raise ValueError("Could not find Current members on the Students page.")
    return [
        clean_text(name)
        for _, name in re.findall(
            r"<li>\s*<a href=[\"']([^\"']*)[\"']>([^<]+)</a>",
            current_section.group(0),
            flags=re.I,
        )
    ]


def scholar_first_author_match(author_line: str, current_members: list[str]) -> str | None:
    first_author = clean_text(author_line.split(",", 1)[0]).rstrip("*")
    match = re.match(r"(?P<initial>[A-Za-z])(?:\.\s*)?\s+(?P<surname>[A-Za-z-]+)$", first_author)
    if not match:
        return None
    initial = match.group("initial").casefold()
    surname = match.group("surname").casefold()
    matches = [
        name for name in current_members
        if name.split()[-1].casefold() == surname
        and name.split()[0].casefold().startswith(initial)
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def scholar_full_first_author_match(author_line: str, current_members: list[str]) -> str | None:
    first_author = clean_text(author_line.split(",", 1)[0]).rstrip("*")
    first_key = content_key(first_author)
    for member in current_members:
        if content_key(member) == first_key:
            return member
    return None


def scrape_scholar_publications(
    scholar_url: str,
    current_members: list[str],
    timeout: int,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    parsed = urllib.parse.urlparse(scholar_url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query["view_op"] = "list_works"
    query["sortby"] = "pubdate"
    rows_by_title: dict[str, str] = {}
    pages_fetched = 0
    rows_fetched = 0
    for start in range(0, 1000, 100):
        if pages_fetched:
            time.sleep(12)
        query["cstart"] = str(start)
        query["pagesize"] = "100"
        page_url = urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))
        source_html = fetch(page_url, timeout)
        pages_fetched += 1
        rows = re.findall(
            r"<tr\b[^>]*class=[\"']gsc_a_tr[\"'][^>]*>(.*?)</tr>",
            source_html,
            flags=re.I | re.S,
        )
        if not rows:
            break
        rows_fetched += len(rows)
        previous_count = len(rows_by_title)
        for row in rows:
            title_match = re.search(
                r"class=[\"']gsc_a_at[\"'][^>]*>(.*?)</a>",
                row,
                flags=re.I | re.S,
            )
            if title_match:
                title = clean_text(re.sub(r"<[^>]+>", " ", title_match.group(1)))
                rows_by_title.setdefault(title.casefold(), row)
        if len(rows) < 100 or len(rows_by_title) == previous_count:
            break
    items: list[dict[str, Any]] = []
    year_counts = {"2025": 0, "2026": 0}
    for index, row in enumerate(rows_by_title.values()):
        title_match = re.search(r"class=[\"']gsc_a_at[\"'][^>]*>(.*?)</a>", row, flags=re.I | re.S)
        gray_values = [
            clean_text(re.sub(r"<[^>]+>", " ", value))
            for value in re.findall(r"<div\b[^>]*class=[\"'][^\"']*gs_gray[^\"']*[\"'][^>]*>(.*?)</div>", row, flags=re.I | re.S)
        ]
        year_cell_match = re.search(
            r"class=[\"']gsc_a_y[\"'][^>]*>(.*?)</td>",
            row,
            flags=re.I | re.S,
        )
        year_match = re.search(r"\b(20(?:25|26))\b", year_cell_match.group(1)) if year_cell_match else None
        if not title_match or not gray_values or not year_match:
            continue
        year_counts[year_match.group(1)] += 1
        title = clean_text(re.sub(r"<[^>]+>", " ", title_match.group(1)))
        author_line = gray_values[0]
        venue = gray_values[1] if len(gray_values) > 1 else ""
        matched_member = scholar_first_author_match(author_line, current_members)
        if not matched_member:
            continue
        if not scholar_first_author_match(author_line, current_members):
            continue
        link_match = re.search(
            r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*class=[\"']gsc_a_at[\"']",
            row,
            flags=re.I,
        )
        scholar_link = html.unescape(link_match.group(1)) if link_match else None
        paper_url = resolve_url("https://scholar.google.com", scholar_link) if scholar_link else scholar_url
        items.append({
            "id": f"scholar-publication-{index + 1}",
            "year": int(year_match.group(1)),
            "title": title,
            "authorLine": author_line,
            "venue": venue,
            "venueStatus": "incomplete" if venue_is_incomplete(venue, title) else "complete",
            "url": paper_url,
            "sourceUrl": scholar_url,
            "memberName": matched_member,
            "authorMatch": "first author is a current member",
            "authorMatchStatus": "accepted",
            "decision": "pending",
        })
    return items, {
        "uniqueScholarRows": len(rows_by_title),
        "scholarPagesFetched": pages_fetched,
        "scholarRowsFetched": rows_fetched,
        "year2025": year_counts["2025"],
        "year2026": year_counts["2026"],
        "matchedCurrentMemberFirstAuthors": len(items),
        "incompleteVenues": sum(1 for item in items if item.get("venueStatus") == "incomplete"),
    }


def parse_scholar_detail(source_html: str) -> dict[str, Any]:
    pairs = re.findall(
        r'<div\b[^>]*class=["\'][^"\']*gsc_oci_field[^"\']*["\'][^>]*>(.*?)</div>\s*'
        r'<div\b[^>]*class=["\'][^"\']*gsc_oci_value[^"\']*["\'][^>]*>(.*?)</div>',
        source_html,
        flags=re.I | re.S,
    )
    fields = {
        clean_text(re.sub(r"<[^>]+>", " ", raw_key)).casefold():
        clean_text(re.sub(r"<[^>]+>", " ", raw_value))
        for raw_key, raw_value in pairs
    }


def parse_crossref_item(candidate: dict[str, Any], expected_title: str, expected_year: int) -> dict[str, Any] | None:
    titles = candidate.get("title") or []
    candidate_title = clean_text(str(titles[0])) if titles else ""
    similarity = difflib.SequenceMatcher(
        None,
        content_key(expected_title),
        content_key(candidate_title),
    ).ratio()
    date_parts = (
        candidate.get("published-print", {}).get("date-parts")
        or candidate.get("published-online", {}).get("date-parts")
        or candidate.get("issued", {}).get("date-parts")
        or []
    )
    raw_year = date_parts[0][0] if date_parts and date_parts[0] else 0
    try:
        candidate_year = int(raw_year or 0)
    except (TypeError, ValueError):
        candidate_year = 0
    if similarity < 0.92 or (candidate_year and abs(candidate_year - expected_year) > 1):
        return None
    containers = candidate.get("container-title") or []
    venue_name = clean_text(str(containers[0])) if containers else ""
    publisher = clean_text(str(candidate.get("publisher", "")))
    volume = clean_text(str(candidate.get("volume", "")))
    issue = clean_text(str(candidate.get("issue", "")))
    pages = clean_text(str(candidate.get("page", "")))
    parts = [venue_name or publisher]
    if volume:
        parts.append(f"vol. {volume}")
    if issue:
        parts.append(f"no. {issue}")
    if pages:
        parts.append(f"pp. {pages}")
    venue = ", ".join(part for part in parts if part)
    doi = clean_text(str(candidate.get("DOI", "")))
    return {
        "venue": venue,
        "publisher": publisher,
        "volume": volume,
        "issue": issue,
        "pages": pages,
        "publicationDate": str(candidate_year or ""),
        "doi": doi,
        "publicationUrl": f"https://doi.org/{doi}" if doi else clean_text(str(candidate.get("URL", ""))),
        "metadataSource": "Crossref",
        "metadataConfidence": round(similarity, 3),
    } if venue else None


def fetch_crossref_metadata(item: dict[str, Any], cache_dir: Path, timeout: int) -> tuple[dict[str, Any] | None, bool]:
    title = clean_text(str(item.get("title", "")))
    year = int(item.get("year", 0) or 0)
    cache_path = cache_dir / (hashlib.sha256(title.encode("utf-8")).hexdigest() + ".json")
    if cache_path.exists():
        payload = load_json(cache_path, {})
        from_cache = True
    else:
        query = urllib.parse.urlencode({
            "query.title": title,
            "rows": "5",
            "select": "DOI,title,published-print,published-online,issued,container-title,volume,issue,page,publisher,URL,type",
        })
        payload = json.loads(fetch(f"https://api.crossref.org/works?{query}", timeout))
        write_json(cache_path, payload)
        from_cache = False
    candidates = payload.get("message", {}).get("items", [])
    matches = [
        parsed for candidate in candidates
        if (parsed := parse_crossref_item(candidate, title, year)) is not None
    ]
    if not matches:
        return None, from_cache
    matches.sort(key=lambda value: value.get("metadataConfidence", 0), reverse=True)
    return matches[0], from_cache


def extract_publisher_preview(source_html: str, page_url: str) -> str:
    candidates: list[tuple[str, str]] = []
    for tag in re.findall(r"<meta\b[^>]*>", source_html, flags=re.I):
        attributes = {
            key.casefold(): html.unescape(value)
            for key, _, value in re.findall(r"([:\w-]+)\s*=\s*([\"'])(.*?)\2", tag, flags=re.I | re.S)
        }
        label = (attributes.get("property") or attributes.get("name") or "").casefold()
        content = attributes.get("content", "").strip()
        if label in {"citation_image", "og:image", "twitter:image", "twitter:image:src"} and content:
            candidates.append((label, resolve_url(page_url, content)))
    priority = {"citation_image": 0, "og:image": 1, "twitter:image": 2, "twitter:image:src": 3}
    candidates.sort(key=lambda pair: priority.get(pair[0], 9))
    for _, candidate in candidates:
        lowered = candidate.casefold()
        if candidate.startswith(("http://", "https://")) and not any(
            marker in lowered for marker in ("logo", "favicon", "default-image", "site-logo")
        ):
            return candidate
    return ""


def fetch_publisher_preview(page_url: str, cache_dir: Path, timeout: int) -> tuple[str, bool]:
    cache_path = cache_dir / (hashlib.sha256(page_url.encode("utf-8")).hexdigest() + ".html")
    if cache_path.exists():
        source_html = cache_path.read_text(encoding="utf-8")
        from_cache = True
    else:
        source_html = fetch(page_url, timeout)
        blocked_text = source_html.casefold()
        if any(marker in blocked_text for marker in ("verifying your request", "unusual traffic", "captcha")):
            return "", False
        cache_path.write_text(source_html, encoding="utf-8")
        from_cache = False
    return extract_publisher_preview(source_html, page_url), from_cache
    venue_name = next((
        fields[key] for key in ("journal", "conference", "book", "source")
        if fields.get(key)
    ), "")
    venue_parts = [venue_name]
    if fields.get("volume"):
        venue_parts.append(f'vol. {fields["volume"]}')
    if fields.get("issue"):
        venue_parts.append(f'no. {fields["issue"]}')
    if fields.get("pages"):
        venue_parts.append(f'pp. {fields["pages"]}')
    if not venue_name and fields.get("publisher"):
        venue_parts.append(fields["publisher"])
    venue = ", ".join(part for part in venue_parts if part)
    doi_match = re.search(r'https?://(?:dx\.)?doi\.org/([^"\'<>\s]+)', source_html, flags=re.I)
    doi = clean_text(fields.get("doi", ""))
    if not doi and doi_match:
        doi = html.unescape(doi_match.group(1)).rstrip(".,;)")
    return {
        "venue": venue,
        "publisher": fields.get("publisher", ""),
        "volume": fields.get("volume", ""),
        "issue": fields.get("issue", ""),
        "pages": fields.get("pages", ""),
        "publicationDate": fields.get("publication date", ""),
        "doi": doi,
        "detailFields": fields,
    }


def create_publication_enrichment_review(config: dict[str, Any], delay_seconds: float) -> Path:
    data_dir = ROOT / config["data_dir"]
    people_path = (ROOT / config["people_file"]).resolve()
    existing = load_json(data_dir / "approved-publications.json", {}).get("items", [])
    cache_dir = data_dir / "scholar-detail-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    crossref_cache_dir = data_dir / "crossref-cache"
    crossref_cache_dir.mkdir(parents=True, exist_ok=True)
    staged: list[dict[str, Any]] = []
    fetched = 0
    cached = 0
    completed = 0
    errors = 0
    last_request_at = 0.0
    for index, original in enumerate(existing, start=1):
        item = dict(original)
        item["decision"] = "pending"
        try:
            metadata = None
            metadata_from_cache = True
            detail_url = str(item.get("url", "")).strip()
            if detail_url.startswith("https://scholar.google.com/citations?"):
                cache_name = hashlib.sha256(detail_url.encode("utf-8")).hexdigest() + ".html"
                cache_path = cache_dir / cache_name
                if cache_path.exists():
                    source_html = cache_path.read_text(encoding="utf-8")
                    blocked_text = source_html.casefold()
                    if not any(marker in blocked_text for marker in (
                        "verifying your request", "unusual traffic", "captcha", "/sgsync"
                    )):
                        scholar_metadata = parse_scholar_detail(source_html)
                        if scholar_metadata.get("venue"):
                            metadata = scholar_metadata
                            metadata["metadataSource"] = "Google Scholar citation detail cache"
                            metadata["metadataConfidence"] = 1.0
                            cached += 1
            if metadata is None:
                crossref_cache_name = hashlib.sha256(str(item.get("title", "")).encode("utf-8")).hexdigest() + ".json"
                crossref_cached = (crossref_cache_dir / crossref_cache_name).exists()
                wait_for = min(max(delay_seconds, 1.0), 3.0) - (time.monotonic() - last_request_at)
                if not crossref_cached and wait_for > 0:
                    time.sleep(wait_for)
                metadata, metadata_from_cache = fetch_crossref_metadata(
                    item,
                    crossref_cache_dir,
                    int(config["request_timeout_seconds"]),
                )
                if not metadata_from_cache:
                    last_request_at = time.monotonic()
                    fetched += 1
                else:
                    cached += 1
            if metadata:
                if detail_url.startswith("https://scholar.google.com/citations?"):
                    item["scholarUrl"] = detail_url
                item.update(metadata)
                if metadata.get("publicationUrl"):
                    item["url"] = metadata["publicationUrl"]
                item["venueStatus"] = "complete"
                item["enrichmentStatus"] = "complete"
                completed += 1
                if item.get("imageSource") == "Publisher page metadata":
                    item.pop("image", None)
                    item.pop("imageSource", None)
                    item.pop("imageStatus", None)
            else:
                item["venueStatus"] = "incomplete"
                item["enrichmentStatus"] = "no high-confidence publisher metadata match"
        except (OSError, UnicodeError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            item["venueStatus"] = "incomplete"
            item["enrichmentStatus"] = f"error: {error}"
            errors += 1
        staged.append(item)
        print(f"Publication detail {index}/{len(existing)}: {item.get('enrichmentStatus', 'staged')}", flush=True)
    batch = {
        "batchId": dt.datetime.now().strftime("%Y%m%d-%H%M%S"),
        "createdAt": now_iso(),
        "mode": "publication-enrichment",
        "mergeApprovedPublications": True,
        "sourceUrl": config["scholar_url"],
        "currentMemberCount": len(load_current_people(people_path)),
        "publicationEligibleMembers": load_current_member_names(people_path),
        "scholarStats": {
            "detailFetched": fetched,
            "detailCached": cached,
            "detailCompleted": completed,
            "detailErrors": errors,
        },
        "pages": {},
        "news": [],
        "newsStats": {},
        "publicationStats": {"scraped": len(staged)},
        "publications": staged,
    }
    output = data_dir / "review.json"
    write_json(output, batch)
    print(f"Publication enrichment review: {output}", flush=True)
    print(f"Completed {completed}/{len(staged)}; fetched {fetched}; cached {cached}; metadata errors {errors}.", flush=True)
    return output


def scrape_publications(url: str, people: list[str], source_html: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    rows = re.findall(r"<tr\b[^>]*>(.*?)</tr>", source_html, flags=re.I | re.S)
    for index, raw_row in enumerate(rows):
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", raw_row, flags=re.I | re.S)
        if len(cells) < 2:
            continue
        citation_html = cells[1]
        citation = clean_text(re.sub(r"<[^>]+>", " ", citation_html))
        year_match = re.search(r"\b(20(?:25|26))\b", citation)
        if not year_match:
            continue
        author_line = citation.split(f"({year_match.group(1)})", 1)[0].strip(" .")
        status, matched = first_author_status(author_line, people)
        if status != "accepted":
            continue
        title_match = re.search(r"\)\.\s*(.*?)\s*<i\b", citation_html, flags=re.I | re.S)
        if title_match:
            title = clean_text(re.sub(r"<[^>]+>", " ", title_match.group(1)))
        else:
            title_match = re.search(r"<i\b[^>]*>(.*?)</i>", citation_html, flags=re.I | re.S)
            title = clean_text(re.sub(r"<[^>]+>", " ", title_match.group(1))) if title_match else citation
        href_match = re.search(r'<a\b[^>]*href=["\']([^"\']+)["\']', citation_html, flags=re.I)
        items.append({
            "id": f"publication-{index + 1}",
            "year": int(year_match.group(1)),
            "title": title,
            "authorLine": author_line,
            "venue": citation,
            "url": resolve_url(url, html.unescape(href_match.group(1))) if href_match else "",
            "sourceUrl": url,
            "firstAuthorStatus": status,
            "matchedPeople": matched,
            "decision": "pending"
        })
    return items


def render_publication_sections(items: list[dict[str, Any]]) -> str:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for item in items:
        grouped.setdefault(int(item["year"]), []).append(item)
    sections = []
    for year in sorted(grouped, reverse=True):
        articles = []
        for item in grouped[year]:
            url = html.escape(str(item.get("url", "")), quote=True)
            link = f'<a href="{url}" class="link">URL</a>' if url else ""
            image = ""
            image_path = str(item.get("image", "")).strip()
            if image_path:
                image = (
                    f'<img src="{html.escape(image_path, quote=True)}" '
                    f'alt="Preview of {escape_html_ascii(item["title"], quote=True)}" '
                    'class="w-28 h-36 object-cover rounded-sm border border-gray-200">'
                )
            articles.append(
                '            <article class="my-2 p-3 flex flex-wrap md:flex-nowrap gap-y-2 gap-x-4 hover:bg-gray-50 transition duration-200">\n'
                f'                {image}\n'
                '                <div class="flex-auto">\n'
                f'                    <h3 class="font-title text-lg">{escape_html_ascii(item["title"])}</h3>\n'
                f'                    <p>{escape_html_ascii(item["authorLine"])}</p>\n'
                f'                    <p>{escape_html_ascii(publication_venue_for_display(item.get("venue", ""), item.get("title", "")))}</p>\n'
                f'                    <p class="flex space-x-2">{link}</p>\n'
                '                </div>\n'
                '            </article>'
            )
        sections.append(
            f'        <section class="mb-4 last:mb-0" data-approved-publications-year="{year}">\n'
            f'            <h2 class="text-2xl font-title mb-2">{year}</h2>\n'
            + "\n".join(articles)
            + "\n        </section>"
        )
    return "\n".join(sections)


def replace_approved_publications_page(items: list[dict[str, Any]]) -> None:
    page_path = ROOT.parent / "publications.html"
    source = page_path.read_text(encoding="utf-8")
    source = re.sub(
        r"\s*<!-- APPROVED PUBLICATIONS START -->.*?<!-- APPROVED PUBLICATIONS END -->\s*",
        "\n",
        source,
        flags=re.S,
    )
    marker = (
        "\n        <!-- APPROVED PUBLICATIONS START -->\n"
        + render_publication_sections(items)
        + "\n        <!-- APPROVED PUBLICATIONS END -->\n"
    )
    insertion = re.search(r"(?m)^\s*<section class=\"mb-4 last:mb-0\">\s*$", source)
    if not insertion:
        raise ValueError(f"Could not find publication sections in {page_path}")
    source = source[:insertion.start()] + marker + source[insertion.start():]
    source = re.sub(
        r"\s*var source = main\.querySelector\('\.publication-year summary span'\);.*?sourceDetails\.before\(example\);\s*}\);\s*",
        "\n",
        source,
        flags=re.S,
    )
    page_path.write_text(source, encoding="utf-8")


def scrape_news(url: str, source_html: str) -> list[dict[str, Any]]:
    month_year = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b", re.I)
    items = []
    paragraphs = re.findall(r"<p\b[^>]*>(.*?)</p>", source_html, flags=re.I | re.S)
    if not paragraphs:
        paragraphs = re.findall(r"<li\b[^>]*>(.*?)</li>", source_html, flags=re.I | re.S)
    for index, raw_paragraph in enumerate(paragraphs):
        paragraph = clean_text(re.sub(r"<[^>]+>", " ", raw_paragraph))
        match = month_year.search(paragraph)
        if not match:
            continue
        items.append({
            "id": f"news-{index + 1}",
            "time": match.group(0),
            "content": clean_text(paragraph[match.end():]).lstrip(":- "),
            "sourceUrl": url,
            "decision": "pending"
        })
    unique, duplicates = deduplicate_news(items)
    for item in unique:
        item["duplicateCount"] = 0
    if duplicates:
        unique.append({
            "id": "scan-summary",
            "time": "",
            "content": f"{duplicates} duplicate News item(s) were removed before review.",
            "sourceUrl": url,
            "decision": "excluded",
            "systemNotice": True
        })
    return unique


def scan(config: dict[str, Any]) -> Path:
    source_url = config["source_url"]
    data_dir = ROOT / config["data_dir"]
    home_html = fetch(source_url, int(config["request_timeout_seconds"]))
    pages = candidate_pages(source_url, home_html)
    news_html = fetch(pages.get("news", source_url), int(config["request_timeout_seconds"]))
    people_path = (ROOT / config["people_file"]).resolve()
    current_people = load_current_people(people_path)
    current_members = load_current_member_names(people_path)
    scraped_news = annotate_news_matches(
        scrape_news(pages.get("news", source_url), news_html),
        current_people,
    )
    scraped_publications, scholar_stats = scrape_scholar_publications(
        config["scholar_url"],
        current_members,
        int(config["request_timeout_seconds"]),
    )
    previous_news = load_json(data_dir / "approved-news.json", {}).get("items", [])
    new_news, historical_news_skipped, news_anchor_found = filter_news_after_published_anchor(
        scraped_news,
        previous_news,
    )
    previous_publications = load_json(data_dir / "approved-publications.json", {}).get("items", [])
    new_publications, historical_publications_skipped, publication_anchor_found = filter_publications_after_published_anchor(
        scraped_publications,
        previous_publications,
    )
    batch = {
        "batchId": dt.datetime.now().strftime("%Y%m%d-%H%M%S"),
        "createdAt": now_iso(),
        "sourceUrl": source_url,
        "currentMemberCount": len(current_people),
        "currentMembers": [person["name"] for person in current_people],
        "publicationEligibleMembers": current_members,
        "scholarStats": scholar_stats,
        "pages": pages,
        "news": new_news,
        "newsStats": {
            "scraped": len(scraped_news),
            "removedWithinBatch": sum(1 for item in scraped_news if item.get("systemNotice")),
            "removedFromApprovedHistory": historical_news_skipped,
            "publishedBaselineAnchorFound": news_anchor_found,
            "matchedCurrentMembers": sum(1 for item in new_news if item.get("memberMatchStatus") == "accepted"),
            "blockedNoCurrentMember": sum(1 for item in new_news if item.get("memberMatchStatus") == "not_found"),
        },
        "publicationStats": {
            "scraped": len(scraped_publications),
            "removedFromApprovedHistory": historical_publications_skipped,
            "publishedBaselineAnchorFound": publication_anchor_found,
        },
        "publications": new_publications
    }
    output = data_dir / "review.json"
    write_json(output, batch)
    print(f"Staged {len(batch['news'])} new News items and {len(batch['publications'])} publications.")
    print(f"News historical rows skipped: {historical_news_skipped}; baseline anchor found: {news_anchor_found}.")
    print(f"Publication historical rows skipped: {historical_publications_skipped}; baseline anchor found: {publication_anchor_found}.")
    print(f"Review file: {output}")
    return output


def create_news_revalidation(config: dict[str, Any]) -> Path:
    """Stage the approved News history for strict People-current-member review."""
    data_dir = ROOT / config["data_dir"]
    people_path = (ROOT / config["people_file"]).resolve()
    current_people = load_current_people(people_path)
    current_members = load_current_member_names(people_path)
    existing = load_json(data_dir / "approved-news.json", {}).get("items", [])
    existing, duplicate_count = deduplicate_news([
        item for item in existing if not item.get("systemNotice")
    ])
    news = annotate_news_matches(existing, current_people)
    for item in news:
        item["decision"] = "pending" if item.get("memberMatchStatus") == "accepted" else "excluded"
    matched = sum(1 for item in news if item.get("memberMatchStatus") == "accepted")
    blocked = sum(1 for item in news if item.get("memberMatchStatus") == "not_found")
    batch = {
        "batchId": dt.datetime.now().strftime("%Y%m%d-%H%M%S"),
        "createdAt": now_iso(),
        "mode": "news-revalidation",
        "replaceApprovedNews": True,
        "sourceUrl": config["source_url"],
        "currentMemberCount": len(current_people),
        "currentMembers": [person["name"] for person in current_people],
        "publicationEligibleMembers": current_members,
        "scholarStats": {},
        "pages": {},
        "news": news,
        "newsStats": {
            "scraped": len(existing),
            "removedWithinBatch": duplicate_count,
            "removedFromApprovedHistory": 0,
            "matchedCurrentMembers": matched,
            "blockedNoCurrentMember": blocked,
        },
        "publicationStats": {"scraped": 0, "removedFromApprovedHistory": 0},
        "publications": [],
    }
    output = data_dir / "review.json"
    write_json(output, batch)
    print(f"News revalidation batch: {output}")
    print(f"Matched current members: {matched}; blocked: {blocked}; duplicates removed: {duplicate_count}.")
    return output


def append_audit(data_dir: Path, record: dict[str, Any]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / "audit.log").open("a", encoding="utf-8", newline="\n") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


def reject_update(data_dir: Path, payload: dict[str, Any]) -> tuple[bool, str]:
    review_path = data_dir / "review.json"
    review = load_json(review_path, {})
    reviewer = clean_text(str(payload.get("reviewerName", "")))
    review_date = clean_text(str(payload.get("reviewDate", "")))
    reason = clean_text(str(payload.get("reason", "")))
    if not reviewer or not review_date or not reason:
        return False, "Reviewer name, review date, and a rejection reason are required."
    if payload.get("batchId") != review.get("batchId"):
        return False, "This Review batch is stale. Reload the page before rejecting it."
    if review.get("reviewStatus") == "rejected":
        return False, "This Review batch has already been rejected."
    rejected_at = now_iso()
    review["reviewStatus"] = "rejected"
    review["rejection"] = {
        "rejectedAt": rejected_at,
        "reviewer": reviewer,
        "reviewDate": review_date,
        "reason": reason,
    }
    write_json(review_path, review)
    append_audit(data_dir, {
        "event": "rejected",
        "batchId": review.get("batchId"),
        "rejectedAt": rejected_at,
        "reviewer": reviewer,
        "reviewDate": review_date,
        "reason": reason,
    })
    return True, "Update rejected. No website content was changed. Resolve the issue and generate a new Review batch."


def approve(data_dir: Path, people_path: Path, payload: dict[str, Any]) -> tuple[bool, str]:
    review = load_json(data_dir / "review.json", {})
    if review.get("reviewStatus") == "rejected":
        return False, "This Review batch was rejected. Resolve the issue and generate a new batch before approval."
    reviewer = clean_text(str(payload.get("reviewerName", "")))
    review_date = clean_text(str(payload.get("reviewDate", "")))
    if not reviewer or not review_date or payload.get("confirmed") is not True:
        return False, "Reviewer name, review date, and explicit confirmation are required."
    publications = [
        item for item in payload.get("publications", [])
        if item.get("decision") == "approved"
    ]
    current_people = load_current_people(people_path)
    current_members = load_current_member_names(people_path)
    for item in publications:
        item["authorMatchStatus"] = (
            "accepted"
            if scholar_first_author_match(str(item.get("authorLine", "")), current_members)
            else "not_found"
        )
    invalid = [
        item.get("title", "Untitled")
        for item in publications
        if item.get("authorMatchStatus") != "accepted" or item.get("decision") != "approved"
    ]
    if invalid:
        return False, "These publications need a current-member first-author match and approval: " + "; ".join(invalid[:5])
    incomplete_venues = [
        item.get("title", "Untitled")
        for item in publications
        if venue_is_incomplete(item.get("venue", ""), item.get("title", ""))
    ]
    if incomplete_venues:
        return False, "Complete the Venue field before approval: " + "; ".join(incomplete_venues[:5])
    news = payload.get("news", review.get("news", []))
    approved_news = [
        item for item in news
        if not item.get("systemNotice") and item.get("decision") == "approved"
    ]
    approved_news = annotate_news_matches(approved_news, current_people)
    invalid_news = [
        item.get("content", "Untitled News")
        for item in approved_news
        if item.get("memberMatchStatus") != "accepted"
    ]
    if invalid_news:
        return False, "These News items do not match a People current member: " + "; ".join(invalid_news[:5])
    news, batch_duplicates = deduplicate_news([
        item for item in approved_news if item.get("memberMatchStatus") == "accepted"
    ])
    if not review.get("replaceApprovedNews"):
        existing_news = load_json(data_dir / "approved-news.json", {}).get("items", [])
        existing_news, _ = deduplicate_news([item for item in existing_news if not item.get("systemNotice")])
        existing_keys = {news_key(item) for item in existing_news}
        news = existing_news + [item for item in news if news_key(item) not in existing_keys]
    if not news and not publications:
        return False, "Select at least one News or Publication item before approval."
    approved_at = now_iso()
    write_json(data_dir / "approved-news.json", {"approvedAt": approved_at, "reviewer": reviewer, "reviewDate": review_date, "items": news})
    if publications:
        existing_publications = load_json(data_dir / "approved-publications.json", {}).get("items", [])
        publication_output = merge_approved_publications(existing_publications, publications)
        write_json(data_dir / "approved-publications.json", {"approvedAt": approved_at, "reviewer": reviewer, "reviewDate": review_date, "items": publication_output})
    sync_and_build_site()
    append_audit(data_dir, {
        "event": "approved",
        "batchId": review.get("batchId"),
        "approvedAt": approved_at,
        "reviewer": reviewer,
        "reviewDate": review_date,
        "newsCount": len(news),
        "publicationCount": len(publications),
        "newsDuplicatesRemovedAtApproval": batch_duplicates,
        "newsGate": "People Current Members + human approval",
        "replacedApprovedNews": bool(review.get("replaceApprovedNews")),
    })
    destinations = []
    if news:
        destinations.append("index.html")
    if publications:
        destinations.append("publications.html")
    return True, (
        f"Approval confirmed. Updated {', '.join(destinations)} and audit.log "
        f"({len(news)} News, {len(publications)} Publications)."
    )


class ReviewHandler(BaseHTTPRequestHandler):
    data_dir: Path
    people_path: Path

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/review":
            self._json(200, load_json(self.data_dir / "review.json", {"error": "Run scan first."}))
            return
        if path in {"/", "/review.html"}:
            body = REVIEW_PAGE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        asset = {"/review.css": ("text/css; charset=utf-8", ROOT / "review.css"),
                 "/review.js": ("text/javascript; charset=utf-8", ROOT / "review.js")}.get(path)
        if asset:
            content_type, asset_path = asset
            body = asset_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        relative_path = urllib.parse.unquote(path).lstrip("/")
        candidate = (SITE_ROOT / relative_path).resolve()
        allowed_suffixes = {
            ".html", ".css", ".js", ".jpg", ".jpeg", ".png", ".gif",
            ".svg", ".webp", ".avif", ".ico", ".woff", ".woff2",
        }
        try:
            candidate.relative_to(SITE_ROOT)
            inside_site = True
        except ValueError:
            inside_site = False
        if (
            relative_path
            and not relative_path.casefold().startswith("automation/")
            and candidate.is_file()
            and inside_site
            and candidate.suffix.casefold() in allowed_suffixes
        ):
            body = candidate.read_bytes()
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path not in {"/api/approve", "/api/reject"}:
            self._json(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length))
            if self.path == "/api/reject":
                ok, message = reject_update(self.data_dir, payload)
            else:
                ok, message = approve(self.data_dir, self.people_path, payload)
            self._json(200 if ok else 422, {"ok": ok, "message": message})
        except (ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
            self._json(400, {"ok": False, "message": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        return


def open_review_page(config: dict[str, Any]) -> str:
    review_url = (
        f'http://{config["review_host"]}:{int(config["review_port"])}'
        f'/review.html?updated={int(time.time())}'
    )
    if sys.platform == "win32":
        os.startfile(review_url)  # type: ignore[attr-defined]
    else:
        webbrowser.open(review_url, new=2)
    print(f"Opened Review UI: {review_url}")
    return review_url


def review_server(config: dict[str, Any], open_browser: bool = True) -> None:
    data_dir = ROOT / config["data_dir"]
    people_path = (ROOT / config["people_file"]).resolve()
    handler = type(
        "ConfiguredReviewHandler",
        (ReviewHandler,),
        {"data_dir": data_dir, "people_path": people_path},
    )
    server = ThreadingHTTPServer((config["review_host"], int(config["review_port"])), handler)
    print(f"Review UI: http://{config['review_host']}:{config['review_port']}/review.html")
    if open_browser:
        # Start the browser after the server has bound its port so the Review
        # page is available by the time the tab begins loading.
        threading.Timer(0.25, open_review_page, args=(config,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("command", choices=["monthly", "scan", "review", "revalidate-news", "enrich-publications", "download-images", "validate-incremental", "test-incremental-review"])
    parser.add_argument("--cutoff", default="2026-06-30", help="Validation cutoff date (YYYY-MM-DD).")
    parser.add_argument("--delay", type=float, default=8.0, help="Seconds between uncached Scholar detail requests.")
    parser.set_defaults(open_review=True)
    parser.add_argument(
        "--open-review",
        dest="open_review",
        action="store_true",
        help="Open the local Review page after staging completes (default).",
    )
    parser.add_argument(
        "--no-open-review",
        dest="open_review",
        action="store_false",
        help="Do not open the Review page after staging completes.",
    )
    args = parser.parse_args()
    config = load_json(args.config.resolve(), {})
    review_output: Path | None = None
    if args.command in {"monthly", "scan"}:
        review_output = scan(config)
    elif args.command == "review":
        review_server(config, open_browser=args.open_review)
    elif args.command == "revalidate-news":
        review_output = create_news_revalidation(config)
    elif args.command == "enrich-publications":
        review_output = create_publication_enrichment_review(config, max(1.0, args.delay))
    elif args.command == "download-images":
        download_publication_images(int(config["request_timeout_seconds"]))
    elif args.command == "validate-incremental":
        validate_incremental_snapshot(
            ROOT / config["data_dir"],
            dt.date.fromisoformat(args.cutoff),
        )
    else:
        review_output = create_incremental_review(
            ROOT / config["data_dir"],
            dt.date.fromisoformat(args.cutoff),
            (ROOT / config["people_file"]).resolve(),
        )
    if args.open_review and review_output is not None:
        review_server(config, open_browser=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
