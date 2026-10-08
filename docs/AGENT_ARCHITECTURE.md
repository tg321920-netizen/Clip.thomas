# ClipForge Agent Architecture

## Purpose

ClipForge's agent layer is a controlled decision layer on top of the existing
workflow, Autopilot, content, publishing, analytics, and marketing services. It
does not replace those services and it does not give a model a shell.

The intended runtime flow is:

```text
Trigger
  -> Workflow / Autopilot
  -> AgentRuntimeService
  -> AgentProvider
  -> Z.ai / ZCode-compatible model endpoint
  -> structured AgentDecision
  -> AgentToolRegistry allowlist
  -> existing ClipForge service
  -> persisted result
  -> next decision

For social delivery:

Agent / Autopilot
  -> Workflow
  -> SocialPublishingRouter
  -> PlatformConnector
       -> TikTokConnector -> existing TikTokProvider
       -> FacebookConnector -> existing FacebookProvider
       -> YouTubeConnector -> existing YouTubeProvider
  -> Publication state / remote post id
  -> Analytics
  -> MarketingMemory
  -> later agent decision
```

ZCode on Android/Termux is useful as a development tool, but the production
agent is not coupled to the CLI or to a phone session. The runtime talks through
the `AgentProvider` abstraction.

## Core contracts

The agent foundation is split into small components:

- `AgentProvider`: asks a model for one structured decision.
- `AgentTask`: objective, trigger, workflow/channel context, autonomy mode and
  hard execution limits.
- `AgentDecision`: one of `TOOL`, `COMPLETE`,
  `WAITING_INFORMATION`, or `WAITING_APPROVAL`.
- `AgentToolRegistry`: the only actions a model can request.
- `AgentExecutionRepository`: durable execution state on the configured
  ClipForge storage volume.
- `AgentOrchestrator`: executes one allowed decision at a time, persists
  results and enforces retry/step/time limits.
- `AgentRuntimeService`: bridge from existing workflows/channels into the
  agent execution model.
- `agent-worker.mjs`: server-side worker that resumes queued/retryable
  executions. It is disabled by default.

Execution records contain the task, current status, step count, retry count,
next retry timestamp, pending approval, recent results, errors, timestamps and
structured history. Atomic filesystem writes use the same storage model as the
current ClipForge runtime. On a persistent volume the execution can be loaded
again after a process restart.

## Allowed tools

The initial allowlist exposes ClipForge capabilities, not operating-system
capabilities:

- `trends.query`
- `channels.status`
- `research.start`
- `script.generate`
- `voice.create`
- `visual.prepare`
- `render.create`
- `publications.query`
- `publishing.prepare`
- `publishing.schedule`
- `publishing.publish`
- `analytics.query`
- `marketing.product.list`
- `marketing.product.read`
- `marketing.memory.read`
- `strategy.update`

Unknown tool names are rejected. Tool inputs and outputs are JSON serializable
and sensitive-looking fields are redacted before they are returned to the model
or written into agent result/history context.

The agent is not given tools for arbitrary shell commands, server file editing,
secret retrieval, infrastructure changes, payments, repository changes, or
direct TikTok/Meta/Google API calls.

## Autonomy modes

### MANUAL

The agent may propose a tool call, but every tool call pauses in
`WAITING_APPROVAL` until a human approves it.

### SEMI_AUTO

Research, generation, voice, visual preparation, render, analytics and other
non-publishing allowlisted tools may run automatically. Scheduling and
publishing pause for human approval. Existing Autopilot behavior maps legacy
`AUTOPILOT` configuration to the new `AUTO` value for compatibility.

### AUTO

The agent may execute allowlisted tools without per-step approval, but real
social delivery is still guarded independently. The following conditions must
all be satisfied before a real publishing path is possible:

1. the workflow/channel is explicitly configured for autonomous operation;
2. `CLIPFORGE_AGENT_REAL_PUBLISHING=true`;
3. the channel is `CONNECTED`;
4. `publishingEnabled=true`;
5. OAuth credentials are present or refreshable;
6. the publication has passed the existing publication/scheduling state
   validations;
7. the rendered clip is ready;
8. owned-content publishing also passes the existing
   `CLIPFORGE_CONTENT_REAL_PUBLISHING` guard;
9. content-specific coherence/rights/approval gates in the owned-content
   workflow must remain in the canonical workflow path.

This branch deliberately keeps both real-publishing flags false. It does not
activate AUTO in production.

## Retries, limits and recovery

Every agent task has bounded limits:

- `maxSteps`: hard stop for decision/action loops;
- `maxRetries`: hard retry ceiling;
- `timeoutMs`: per-run wall-clock limit;
- `baseBackoffMs`: exponential retry base delay.

Retryable provider/tool errors move the execution to `WAITING_RETRY` with a
persisted `nextAttemptAt`. Rate-limit and temporary provider errors can
therefore recover without a tight loop. Non-recoverable model/provider
failures fall back to `WAITING_INFORMATION` instead of guessing an action.
Exhausted tool retries become `FAILED`.

The agent worker reads persisted `QUEUED` and `WAITING_RETRY` records on the
next cycle, so a runtime restart does not require an in-memory conversation to
continue.

## Z.ai / ZCode provider

`ZaiAgentProvider` implements `AgentProvider` using the existing
OpenAI-compatible structured JSON transport. Runtime configuration is
server-side:

```text
CLIPFORGE_AGENT_ENABLED=false
CLIPFORGE_AGENT_REAL_PUBLISHING=false
CLIPFORGE_ZAI_API_KEY=
CLIPFORGE_ZAI_BASE_URL=https://api.z.ai/api/paas/v4
CLIPFORGE_ZAI_MODEL=
CLIPFORGE_ZAI_API_STYLE=chat-completions
CLIPFORGE_ZAI_TEMPERATURE=0.2
CLIPFORGE_ZAI_MAX_OUTPUT_TOKENS=1400
```

No credential is committed to the repository. The ZCode CLI login on Termux is
not copied into ClipForge and is not treated as the permanent runtime
credential.

Z.ai exposes an OpenAI-compatible general API endpoint. Z.ai also exposes a
Coding Plan endpoint intended for coding-agent scenarios. ClipForge therefore
defaults the product/runtime provider to the general API endpoint and does not
assume that a ZCode/Coding Plan subscription automatically authorizes or pays
for autonomous content-runtime calls. The actual API key, model and commercial
entitlement must be confirmed when the user chooses to connect Z.ai.

## TikTok, Facebook and YouTube

The three platforms are first-class connectors, not a generic TODO.

### TikTok

`TikTokConnector` wraps the existing `TikTokProvider`. The provider already
implements Direct Post initialization, local-file upload, verified URL pull,
creator-info checks, per-post consent requirements and publication-status
polling. OAuth refresh remains owned by `OAuthConnectionService`.

### Facebook

`FacebookConnector` wraps the existing `FacebookProvider`. Publishing is for
an authorized Facebook Page/Reel path, with Page identity/token requirements,
configured Graph API version and status polling. OAuth/Page selection remains
owned by `OAuthConnectionService`.

### YouTube

`YouTubeConnector` wraps the existing `YouTubeProvider`. It supports video
upload, processing/status checks and provider analytics available through the
current YouTube implementation.

### Connector status contract

A connector status includes:

- connected/disconnected channel state;
- `publishingEnabled`;
- external account/channel/page identifier;
- OAuth state: vault missing, credentials missing, valid, refreshable or
  expired;
- refresh availability without exposing tokens;
- provider capabilities and requirements;
- publishing readiness.

Scheduling is currently performed by ClipForge's `SchedulerService` rather
than delegated to a native platform scheduler. That keeps the scheduling state
consistent across all three platforms.

The publishing path uses the existing `PublishingService`, which records the
remote provider id/status in the persisted `Publication` record. Provider
errors are normalized with a stable code plus `retryable`,
`rateLimited` and `reauthorizationRequired` signals. The agent's bounded
backoff layer consumes those retryable signals.

Current analytics support is capability-based. YouTube currently exposes
`getAnalytics` through its provider. TikTok and Facebook do not yet expose
provider analytics methods in the repository, so their connector status
reports analytics as unsupported rather than fabricating data. This remains a
real integration gap for later provider-specific work.

## Owned content and product marketing

Owned editorial content remains on the existing Content Factory /
`OwnedContentWorkflowRunner` path, including research/source traceability,
script generation, rights/coherence checks, approval, render and dry-run
publication. The existing channel families remain independent configurations,
including US NEWS EN, LATAM NEWS ES and ENTERTAINMENT / GOSSIP ES.

Product marketing is separate. `ProductProfileService` stores only product
configuration inside ClipForge:

- name and description;
- audience and country;
- branding;
- CTA;
- posting frequency/times;
- TikTok/Facebook/YouTube targets;
- objectives.

No El Tico Bretea, TexaChamba, MetaBot, or future product repository is copied
into ClipForge. Those names can later be represented as product profiles and
fed into the existing marketing workflow/services.

## Analytics and evidence-based learning

The analytics layer records real provider snapshots. The performance layer can
derive signals for:

- platform;
- duration;
- subtitle style;
- topic;
- format;
- local publication hour;
- engagement;
- average watch time / retention when available;
- CTR when supplied directly or when impressions + clicks exist.

Relative performance signals require a minimum measured sample and multiple
samples in compared groups. The signal remains evidence, not an automatic fact
or strategy rewrite. `MarketingMemoryService` exposes those evidence records
to the agent for later decisions.

## Relationship with existing Workflow and Autopilot

This layer does not replace `WorkflowService`, `AutopilotService`,
`OwnedContentWorkflowRunner`, `MarketingWorkflowRunner`,
`SchedulerService`, `JobStore`, Analytics or Marketing Memory.

`WorkflowService` now persists an autonomy mode. Channel strategy also stores
an agent autonomy mode. `AgentRuntimeService.createForWorkflowExecution()`
turns an existing workflow execution into an agent task while preserving its
workflow/channel/project context.

Triggers can create agent tasks, while the existing worker and workflow
machinery continue to perform deterministic/media work. This separation keeps
the model responsible for bounded decisions and ClipForge responsible for
actual side effects.

## Enabling later

To perform a controlled real integration later:

1. deploy the runtime on durable storage;
2. configure a valid Z.ai API key/model if Z.ai is selected as the agent brain;
3. create/authorize the official TikTok, Meta and Google apps;
4. configure the existing OAuth environment variables and redirect URIs;
5. connect accounts in ClipForge;
6. verify connector status and capabilities;
7. keep workflows in MANUAL/SEMI_AUTO for controlled end-to-end tests;
8. validate TikTok/Facebook/YouTube publication and analytics behavior with
   authorized test content;
9. explicitly enable channel publishing;
10. only after those checks, enable the appropriate real-publishing flags and
    selected AUTO workflows.

## Remaining infrastructure dependencies

The current free Render runtime uses ephemeral storage. Persistent workflows,
agent executions, encrypted OAuth credentials, projects and renders need the
persistent runtime/disk described by `render.production.yaml` (or an
equivalent durable design). No production deployment or paid infrastructure is
activated by this branch.

Real OAuth, real social publishing and real Z.ai credentials are intentionally
not configured here.
