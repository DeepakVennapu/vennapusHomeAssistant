from __future__ import annotations

import aiohttp
import logging

from homeassistant.components import conversation
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers import intent

_LOGGER = logging.getLogger(__name__)
BRIDGE_URL = "http://localhost:8124/converse"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    agent = ClaudeConversationAgent(hass)
    conversation.async_set_agent(hass, entry, agent)
    return True


class ClaudeConversationAgent(conversation.AbstractConversationAgent):
    """Routes HA Assist input to ha_bridge and returns spoken response."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    @property
    def supported_languages(self) -> list[str]:
        return ["en"]

    async def async_process(
        self, user_input: conversation.ConversationInput
    ) -> conversation.ConversationResult:
        text = user_input.text

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    BRIDGE_URL,
                    json={"text": text, "source": "assist"},
                    timeout=aiohttp.ClientTimeout(total=12),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        reply = data.get("response", "Done.")
                    else:
                        reply = "I couldn't complete that action — HA returned an error."
        except Exception as e:
            _LOGGER.error("ha_bridge unreachable: %s", e)
            reply = "Assistant unavailable, try again shortly."

        response = intent.IntentResponse(language=user_input.language)
        response.async_set_speech(reply)
        return conversation.ConversationResult(response=response)
