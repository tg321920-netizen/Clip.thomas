# Z.ai autonomous agent handoff

## Runtime

The server-side path is:

Z.ai general API -> ZaiAgentProvider -> AgentRuntimeService ->
AgentOrchestrator -> AgentToolRegistry -> ClipForge services.

ZCode and Termux are development tools only. The runtime does not require an
Android session.

## Configuration names

Agent runtime variables:

- CLIPFORGE_AGENT_ENABLED
- CLIPFORGE_AGENT_MODE
- CLIPFORGE_AGENT_REAL_PUBLISHING
- CLIPFORGE_AGENT_OBJECTIVE
- CLIPFORGE_AGENT_CYCLE_MS
- CLIPFORGE_AGENT_RULES_JSON

Z.ai provider variables:

- CLIPFORGE_ZAI_API_KEY
- CLIPFORGE_ZAI_MODEL
- CLIPFORGE_ZAI_BASE_URL
- CLIPFORGE_ZAI_API_STYLE
- CLIPFORGE_ZAI_TIMEOUT_MS

The provider also accepts ZAI_API_KEY, ZAI_MODEL, ZAI_BASE_URL and
ZAI_TIMEOUT_MS as compatibility aliases.

The normal runtime uses the general Z.ai endpoint. Coding Plan endpoints are
not substituted automatically.

## SEMI_AUTO

The initial server mode is SEMI_AUTO unless a task or workflow explicitly
chooses another supported mode.

When CLIPFORGE_AGENT_OBJECTIVE is configured, the worker can seed one bounded
autonomous cycle. It does not create another cycle while an execution is
queued, running, retrying, waiting for information or waiting for approval.

Research, scripts, preparation, rendering, analytics and publication
preparation may advance through the allowlisted ClipForge tools. Scheduling
and publishing remain governed by approval and publishing guards.

## Rules

CLIPFORGE_AGENT_RULES_JSON can define:

- allowedSources and blockedSources
- allowedTopics and blockedTopics
- countries and languages
- channels and preferredTimes
- maxPostsPerDay
- maxDailyAiBudgetUsd and maxJobAiBudgetUsd
- maxRetries
- approvalRequired
- publishingEnabled

Source, topic, language and target-platform restrictions are enforced when the
corresponding tool input exposes those fields. Publishing is also protected by
the central autonomy policy and the existing channel/OAuth/publication checks.

## Provider reliability

The Z.ai transport has a bounded timeout. Network failures, timeouts, rate
limits and temporary server failures are retryable through the existing
bounded backoff. Permanent failures stop safely. Empty or invalid structured
responses are rejected.

## Persistence

AgentExecutionRepository uses shared KV when CLIPFORGE_REDIS_URL is configured
and also keeps a local cache. The free Render filesystem is ephemeral, so KV
is the preferred recovery path for agent execution state across replacement.

Media files and other filesystem-backed project data have separate durability
requirements.

## Later AUTO activation

Do not enable real AUTO publishing until the selected provider, content rules,
OAuth, channel connection, channel publishing setting, controlled publication
tests and rights/coherence checks have all been verified.

Changing the autonomy mode alone never authorizes a real post.

## Future channels

TikTok, Facebook, YouTube and later platforms stay behind
SocialPublishingRouter and PlatformConnector. The model never receives direct
social-platform credentials.

## Remaining owner actions

External account authorization remains owner-controlled: configure the Z.ai
runtime credential in the hosting environment, complete OAuth consent when a
platform requires it, and explicitly decide when real publishing may be
enabled.


## Owner approval UI

The Autopilot dashboard at `/autopilot` now includes the server-side agent
execution panel. It reads `/api/agent/executions` and exposes only controlled
actions for an existing execution: approve, provide owner information, cancel,
or run a queued execution.

Approval removes only the human-approval requirement for that pending tool
decision. It does not bypass the real-publishing gate or the agent publishing
rules. If a hard guard becomes false after an approval request was created, the
approved action is still blocked safely.

The owner panel never receives the Z.ai API key or social OAuth credentials.
