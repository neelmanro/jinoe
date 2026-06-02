from __future__ import annotations

from typing import Any

import httpx

from .config import AssistantConfig


class TavilyClient:
    def __init__(self, config: AssistantConfig) -> None:
        self.config = config

    async def search(self, query: str, *, max_results: int = 5) -> dict[str, Any]:
        return await self._post(
            "https://api.tavily.com/search",
            {
                "query": query,
                "search_depth": "advanced",
                "max_results": max(1, min(max_results, 10)),
                "include_answer": False,
                "include_raw_content": False,
            },
        )

    async def extract(self, urls: list[str]) -> dict[str, Any]:
        return await self._post(
            "https://api.tavily.com/extract",
            {
                "urls": urls[:5],
                "extract_depth": "advanced",
                "include_images": False,
            },
        )

    async def _post(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.config.tavily_api_key:
            raise RuntimeError("Missing TAVILY_API_KEY")
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            response = await client.post(
                url,
                headers={"Content-Type": "application/json"},
                json={"api_key": self.config.tavily_api_key, **payload},
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise RuntimeError("Tavily returned an invalid response")
            return data

