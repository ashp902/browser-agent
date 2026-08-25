"""Browser action wire contracts mirroring the extension's TypeScript types
(docs/03 §4-§18). The backend constructs these requests and validates results;
it never touches DOM-level details."""

from typing import Any, Literal

from pydantic import BaseModel, Field

BrowserToolName = Literal[
    "click_element",
    "set_text",
    "select_option",
    "set_checked",
    "press_key",
    "scroll_page",
    "scroll_element",
    "navigate_current_tab",
    "go_back",
]

BROWSER_TOOLS: tuple[str, ...] = (
    "click_element",
    "set_text",
    "select_option",
    "set_checked",
    "press_key",
    "scroll_page",
    "scroll_element",
    "navigate_current_tab",
    "go_back",
)


class ExpectedTarget(BaseModel):
    role: str
    normalized_name: str
    tag_name: str
    input_type: str | None = None
    href_origin: str | None = None


class BrowserActionRequest(BaseModel):
    protocol_version: Literal[1] = 1
    action_id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    observed_mutation_epoch: int = Field(ge=0)
    tool: BrowserToolName
    args: dict[str, Any] = Field(default_factory=dict)
    expected_target: ExpectedTarget | None = None
    # docs/05 §7 / docs/03 §20: present only for user-approved consequential
    # actions; bound to action, document, target fingerprint, and expiry.
    confirmation_token: str | None = None


class ActionError(BaseModel):
    code: str
    message: str
    retryable: bool | None = None


class ActionResultModel(BaseModel):
    protocol_version: Literal[1] = 1
    action_id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    mutation_epoch_before: int = Field(ge=0)
    mutation_epoch_after: int = Field(ge=0)
    ok: bool
    changed: bool | None = None
    summary: str
    data: dict[str, Any] | None = None
    error: ActionError | None = None
