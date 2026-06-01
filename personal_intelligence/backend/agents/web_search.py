"""Web search agent — DuckDuckGo -> fetch pages -> brain summarizes with citations.

Reuses the proven DDG approach from the Compari'son app (rate-limit retries, the
``ddgs``/``duckduckgo_search`` import shim). The brain's job is judgment: answer
the question from the fetched snippets/text and cite which results it used.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET

import httpx

from agents import AgentResult
from ollama_client import chat

try:
    from ddgs import DDGS  # type: ignore
except ImportError:  # pragma: no cover - older installs
    from duckduckgo_search import DDGS  # type: ignore

_MAX_RESULTS = 5
_FETCH_CHARS = 2000  # per page, keeps the brain's context small + fast

# Google News RSS — keyless, no rate limits, always current. Far more reliable
# than DDG for news. Region is configurable; defaults to US/English.
_NEWS_REGION = os.environ.get("PI_NEWS_REGION", "US")
_NEWS_LANG = os.environ.get("PI_NEWS_LANG", "en")


# Words that signal the user wants fresh news/headlines rather than a reference
# lookup — these route to DDG's news endpoint, which returns dated headlines with
# summaries (no fragile homepage scraping needed).
_NEWS_HINTS = (
    "news", "headline", "headlines", "today", "tonight", "this morning",
    "latest", "breaking", "current events", "happening", "right now",
    "this week", "recently", "update on",
)


def _is_news(query: str) -> bool:
    q = query.lower()
    return any(h in q for h in _NEWS_HINTS)


# Stopwords stripped to decide top-stories vs a topical news search.
_NEWS_STOP = set(_NEWS_HINTS) | {
    "what", "is", "the", "are", "whats", "what's", "give", "me", "show",
    "tell", "about", "any", "some", "on", "of", "in", "for", "a", "an",
    "personal_intelligence", "please", "current", "now",
}


def _news_query(query: str) -> str:
    """Reduce a query to its topical terms; empty means 'top stories'."""
    words = re.findall(r"[a-zA-Z0-9]+", query.lower())
    return " ".join(w for w in words if w not in _NEWS_STOP).strip()


async def _fetch_news_rss(query: str) -> list[dict]:
    """Fetch current headlines from Google News RSS (keyless, no rate limit)."""
    topic = _news_query(query)
    ceid = f"{_NEWS_REGION}:{_NEWS_LANG}"
    base = "https://news.google.com/rss"
    if topic:
        url = (
            f"{base}/search?q={urllib.parse.quote(topic)}"
            f"&hl={_NEWS_LANG}-{_NEWS_REGION}&gl={_NEWS_REGION}&ceid={ceid}"
        )
    else:
        url = f"{base}?hl={_NEWS_LANG}-{_NEWS_REGION}&gl={_NEWS_REGION}&ceid={ceid}"

    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0 (Personal Intelligence news)"}, timeout=12.0
        ) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
    except (httpx.HTTPError, ET.ParseError):
        return []

    out: list[dict] = []
    for item in list(root.iterfind(".//item"))[:_MAX_RESULTS]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        src_el = item.find("{*}source")
        source = (src_el.text.strip() if src_el is not None and src_el.text else "")
        # Google prepends "Headline - Source"; keep the headline clean.
        if source and title.endswith(f"- {source}"):
            title = title[: -len(f"- {source}")].strip()
        out.append(
            {
                "title": title,
                "body": "",  # RSS gives headline + source; that's enough to brief
                "url": link,
                "meta": " · ".join(x for x in (pub[:16], source) if x),
            }
        )
    return out


def _norm(hits: list, kind: str) -> list[dict]:
    """Normalize DDG text/news hits to {title, body, url, meta}."""
    out = []
    for h in hits:
        out.append(
            {
                "title": h.get("title", ""),
                "body": h.get("body", "") or h.get("excerpt", ""),
                "url": h.get("href") or h.get("url", ""),
                # news items carry date + source; surface them for the summarizer
                "meta": " · ".join(
                    x for x in (h.get("date", "")[:10], h.get("source", "")) if x
                ) if kind == "news" else "",
            }
        )
    return out


def _search(query: str, prefer_news: bool, retries: int = 4, backoff: float = 2.0) -> list[dict]:
    """Blocking DDG search with backoff.

    For news-intent queries, try the news endpoint first (structured, dated
    headlines), then fall back to text. For everything else, text first, then
    news as a last resort. Returns [{title, body, url, meta}].
    """
    order = ["news", "text"] if prefer_news else ["text", "news"]
    last_err: Exception | None = None
    for attempt in range(retries):
        for kind in order:
            try:
                with DDGS() as ddgs:
                    fn = ddgs.news if kind == "news" else ddgs.text
                    hits = list(fn(query, max_results=_MAX_RESULTS))
                if hits:
                    return _norm(hits, kind)
            except Exception as e:  # rate limit / network blip / endpoint quirk
                last_err = e
        if attempt < retries - 1:
            time.sleep(backoff * (attempt + 1))
    if last_err is not None:
        raise last_err
    return []


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    """Fetch a page and crudely strip it to readable text (no heavy deps)."""
    try:
        resp = await client.get(url, follow_redirects=True, timeout=10.0)
        resp.raise_for_status()
        html = resp.text
    except (httpx.HTTPError, UnicodeDecodeError):
        return ""
    # Drop script/style blocks, then all tags.
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = _WS_RE.sub(" ", _TAG_RE.sub(" ", html)).strip()
    return text[:_FETCH_CHARS]


_SUMMARY_SYSTEM = """You are Personal Intelligence's research module. Using ONLY the provided
search results, answer the user's question accurately and concisely.

- Lead with the direct answer in 2-4 sentences.
- Cite sources inline as [1], [2] matching the numbered results.
- If the results don't actually answer the question, say so plainly.
- Do not invent facts, prices, or dates that aren't in the results."""

_NEWS_SYSTEM = """You are Personal Intelligence's news module. You are given today's top headlines
(each with a date, source, and short summary). Brief the user on the current news.

- Open with one short line, then give 4-6 bullet headlines.
- For each: a crisp one-line summary, with the source and [n] citation.
- Use ONLY the provided headlines — do not invent stories or details.
- These ARE current results, so never claim you lack up-to-date information."""


async def run(query: str) -> AgentResult:
    is_news = _is_news(query)

    hits: list[dict] = []
    # News: try Google News RSS first (reliable, current), then DDG news as backup.
    if is_news:
        hits = await _fetch_news_rss(query)

    if not hits:
        # DDG client is sync; run it off the event loop so fan-out stays parallel.
        try:
            hits = await asyncio.to_thread(_search, query, is_news)
        except Exception:
            return AgentResult(
                name="web_search",
                answer="(web search is rate-limited right now — try again in a moment)",
                ok=False,
            )
    if not hits:
        return AgentResult(name="web_search", answer="(no web results found)", ok=False)

    # News headlines already carry dated summaries — scraping news sites mostly
    # yields paywalls/nav junk, so skip the fetch there. For reference lookups,
    # enrich the snippets by fetching the actual pages.
    if is_news:
        bodies = [""] * len(hits)
    else:
        headers = {"User-Agent": "Mozilla/5.0 (Personal Intelligence research agent)"}
        async with httpx.AsyncClient(headers=headers) as client:
            bodies = await asyncio.gather(*[_fetch_text(client, h["url"]) for h in hits])

    blocks = []
    sources = []
    for i, (h, body) in enumerate(zip(hits, bodies), start=1):
        context = body or h["body"]
        head = f"[{i}] {h['title']}"
        if h.get("meta"):
            head += f"  ({h['meta']})"
        blocks.append(f"{head}\n{h['url']}\n{context}")
        sources.append({"title": h["title"] or h["url"], "url": h["url"]})

    system = _NEWS_SYSTEM if is_news else _SUMMARY_SYSTEM
    user = f"Question: {query}\n\nSearch results:\n\n" + "\n\n".join(blocks)
    answer = await chat(system, user, temperature=0.2)

    return AgentResult(
        name="web_search",
        answer=answer or "(could not summarize the web results)",
        sources=sources,
    )
