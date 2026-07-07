import json
import re
from typing import Any, TypeVar

from fastapi import HTTPException
from openai import APIConnectionError, APIError, APITimeoutError, OpenAI
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.prompts import CHAT_SYSTEM_PROMPT, REPORT_REVIEW_SYSTEM_PROMPT
from app.schemas import ChatResponse, ReportReviewResponse


T = TypeVar("T", bound=BaseModel)


class DeepSeekService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client: OpenAI | None = None
        if self.settings.deepseek_api_key:
            self.client = OpenAI(
                api_key=self.settings.deepseek_api_key,
                base_url=self.settings.deepseek_base_url,
                timeout=self.settings.request_timeout_seconds,
            )

    def _ensure_client(self) -> OpenAI:
        if self.client is None:
            raise HTTPException(
                status_code=503,
                detail="未配置 DEEPSEEK_API_KEY。请在 .env 中配置 DeepSeek API Key 后重启服务。",
            )
        return self.client

    def _chat_json(self, system_prompt: str, user_content: str, temperature: float) -> str:
        client = self._ensure_client()
        try:
            response = client.chat.completions.create(
                model=self.settings.deepseek_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
        except APITimeoutError as exc:
            raise HTTPException(status_code=504, detail="DeepSeek API 请求超时，请稍后重试。") from exc
        except APIConnectionError as exc:
            raise HTTPException(status_code=502, detail="无法连接 DeepSeek API，请检查网络或 BASE_URL 配置。") from exc
        except APIError as exc:
            message = getattr(exc, "message", None) or str(exc)
            raise HTTPException(status_code=502, detail=f"DeepSeek API 调用失败：{message}") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"模型调用异常：{exc}") from exc

        content = response.choices[0].message.content if response.choices else None
        if not content:
            raise HTTPException(status_code=502, detail="DeepSeek API 未返回有效内容。")
        return content

    @staticmethod
    def _load_json(content: str) -> dict[str, Any]:
        content = content.strip()
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content, flags=re.IGNORECASE)
        if fence_match:
            try:
                parsed = json.loads(fence_match.group(1).strip())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

        raise HTTPException(
            status_code=502,
            detail="模型返回内容不是合格 JSON，且无法从 markdown JSON 代码块中提取。请重试或降低输入复杂度。",
        )

    @staticmethod
    def _validate(parsed: dict[str, Any], model: type[T]) -> T:
        try:
            return model.model_validate(parsed)
        except ValidationError as exc:
            raise HTTPException(status_code=502, detail=f"模型 JSON 结构不符合接口要求：{exc.errors()}") from exc

    def answer_question(self, question: str) -> ChatResponse:
        content = self._chat_json(
            CHAT_SYSTEM_PROMPT,
            f"请基于以下问题生成辅助研判结果：\n\n{question}",
            temperature=0.35,
        )
        return self._validate(self._load_json(content), ChatResponse)

    def review_report(self, report_text: str) -> ReportReviewResponse:
        content = self._chat_json(
            REPORT_REVIEW_SYSTEM_PROMPT,
            f"请复核以下风控核查报告正文，仅依据正文显式信息输出指定 JSON：\n\n{report_text}",
            temperature=0.15,
        )
        result = self._validate(self._load_json(content), ReportReviewResponse)
        result.keyword_check.status = "暂未启用"
        result.keyword_check.content = "当前演示版本暂未接入既有关键字检索指标与规则库，本项不作自动命中判定。"
        return result
