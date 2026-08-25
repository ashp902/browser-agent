"""Versioned consequence-policy rules (docs/06 §7-§8).

Deterministic keyword families live here, never in prompts. Matching is
phrase-based over word tokens so "book" does not fire on "facebook". False
positives are preferable to unconfirmed consequential actions (docs/06 §8).

History: v1 - initial MVP families from docs/06 §8.
"""

import re

POLICY_RULES_VERSION = 1

# docs/06 §8 keyword families; lowercase multi-word phrases allowed.
CONFIRM_PHRASES: tuple[str, ...] = (
    "place order",
    "buy now",
    "purchase",
    "pay",
    "submit payment",
    "transfer",
    "send",
    "submit claim",
    "book",
    "confirm booking",
    "cancel subscription",
    "cancel order",
    "delete account",
    "delete",
    "remove account",
    "publish",
    "agree and submit",
    "accept terms",
    "agree to terms",
    "submit order",
    "checkout",
)

# docs/06 §7.3 manual-only cues for text-entry targets.
SECRET_FIELD_PHRASES: tuple[str, ...] = (
    "password",
    "passcode",
    "one-time code",
    "otp",
    "card number",
    "card-number",
    "cvv",
    "cvc",
    "security code",
    "card verification",
    "expiry",
    "expiration",
)

# Interaction targets whose names suggest human-verification challenges.
CAPTCHA_PHRASES: tuple[str, ...] = ("captcha", "human verification", "i am not a robot")

# URL fragments that make otherwise-ordinary actions suspicious.
SUSPICIOUS_URL_PHRASES: tuple[str, ...] = (
    "webmail",
    "admin",
    "credential",
)


def _word_tokens(text: str) -> list[str]:
    """Lowercase alphanumeric word tokens; punctuation carries no identity."""
    return [token for token in re.split(r"[^a-z0-9]+", text.lower()) if token]


def phrase_in_tokens(phrases: tuple[str, ...], normalized_text: str) -> bool:
    """True when any phrase appears as a consecutive run of word tokens."""
    tokens = _word_tokens(normalized_text)
    for phrase in phrases:
        phrase_tokens = _word_tokens(phrase)
        length = len(phrase_tokens)
        if length == 0 or length > len(tokens):
            continue
        for start in range(len(tokens) - length + 1):
            if tokens[start : start + length] == phrase_tokens:
                return True
    return False


def contains_phrase(phrases: tuple[str, ...], *texts: str | None) -> bool:
    """Any text contains any phrase as whole words (case-insensitive)."""
    for text in texts:
        if not text:
            continue
        if phrase_in_tokens(phrases, text.strip().lower()):
            return True
    return False
