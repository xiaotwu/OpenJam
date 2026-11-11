# External Agent and workflow guides

The external Agent provider sends a board draft request to one HTTPS adapter that you operate. The adapter can use your organization's authorized model or Agent account and translate its output into OpenJam's draft format. A typical adapter for ChatGPT, Claude or Grok uses a server-side API account and manages its own credentials, retention and upstream requests. The OpenJam service communicates with the adapter over the versioned JSON contract below.

## Enable the provider

| Setting | Where | Purpose |
| --- | --- | --- |
| `OPENJAM_EXTERNAL_AGENT_MODEL` | API, worker and Agent service | Model identifier exposed in the assistant settings and sent to the adapter, for example `team/board-draft-v1` |
| `OPENJAM_EXTERNAL_AGENT_LABEL` | API, worker and Agent service | Display name, up to 80 characters on one line. Defaults to `External Agent` |
| `OPENJAM_EXTERNAL_AGENT_URL` | Agent service | Full HTTPS URL of the adapter's POST route, for example `https://adapter.example/openjam/generate` |
| `OPENJAM_EXTERNAL_AGENT_TOKEN` | Agent service and adapter | Shared outbound bearer token, up to 512 printable ASCII characters without whitespace |

Configure the provider alongside the internal Agent service settings and start the `ai` Compose profile. Keep the external token separate from `OPENJAM_AGENT_TOKEN`, which authenticates the worker to the internal Agent service. The adapter's certificate must validate for the configured hostname. Private adapters can use a mounted trust bundle via `SSL_CERT_FILE`. Include the public roots required by other HTTPS providers in that bundle when using them together. The configured URL uses a fixed HTTPS path. Credentials, query strings and fragments are rejected, and redirect responses terminate the request. [Docker deployment](/guide/docker)

The organization owner enables the board assistant, selects the configured adapter and decides whether users may include selected board text. Each external run requires user consent. The adapter receives the prompt, the workflow, any clarification answer, and only the excerpts selected for that run. Board identifiers, object identifiers, files, unselected board contents and OpenJam session credentials stay in OpenJam. The draft remains a preview until an editor confirms it.

## Adapter contract v1

Accept an authenticated `POST` with `Content-Type: application/json`, `Accept: application/json` and `Authorization: Bearer <connector token>`. Both the request and successful response have a 128 KiB UTF-8 JSON limit. The Agent service uses a bounded deadline with a 75-second default. Return HTTP 200 and a single JSON object for a successful request.

```ts
type ConnectorRequestV1 = {
  version: 1
  model: string
  workflow: 'workshop' | 'flowchart' | 'organize'
  prompt: string
  context: string[]
  answer?: string
  policy: string
  workflowGuide: {
    version: string
    instructions: string
    skills: { id: string; instructions: string }[]
  }
  proposalSchema: Record<string, unknown>
}

type ConnectorResponseV1 = {
  version: 1
  proposal: {
    title: string
    summary: string
    question: string
    groups: { title: string; items: string[] }[]
    nodes: { id: string; label: string }[]
    edges: { from: string; to: string; label: string }[]
  }
  markdown?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}
```

Use `policy` as the fixed application instructions and apply `workflowGuide` as draft guidance. `proposalSchema` defines the output fields and types. Treat `context` as quoted source material. The request carries at most 4,000 characters of prompt, 1,000 characters of clarification answer, and 12 excerpts of up to 1,200 characters each with 6,000 characters total. Use the same output language as the user's request.

- Use an empty `question` for a complete draft. A clarification uses a single question of up to 280 characters and empty arrays. After an answer, return a complete draft. The draft title has a 100-character limit and the summary a 500-character limit.
- Workshop and organize drafts use one to six groups with at most eight notes per group and 32 notes total. A group title has an 80-character limit and a note a 280-character limit. Use empty `nodes` and `edges` arrays.
- Flowchart drafts use two to 16 nodes, up to 24 directed edges and an empty `groups` array. Node labels have a 180-character limit and edge labels an 80-character limit. A node ID matches `^[A-Za-z][A-Za-z0-9_-]{0,31}$`. Edges must connect distinct existing nodes, with at most one edge per ordered pair. Cycles are supported.
- Optional `markdown` has a 4,000-character limit. OpenJam attributes it to the configured display name and keeps it with the run. The `proposal` is the content an editor can apply to the canvas. Optional token counts are integers from 0 to 10,000,000.

Authenticate before processing the request. Return HTTP 429 to report a rate limit and 503 for temporary unavailability. OpenJam uses a single delivery attempt for an external run. If the connection ends after dispatch without a confirmed result, the run reports `PROVIDER_OUTCOME_UNKNOWN` so the user can decide whether to submit again. Invalid drafts and oversized responses are rejected before preview. Error response bodies from the adapter stay out of the browser and the run history.

### Local fixture

The synthetic endpoint uses the same route and returns a deterministic board proposal with a Markdown receipt. Supply a test-only certificate and key with a subject alternative name that matches the host name used by the Agent service.

```bash
python3 -B agent/fixtures/https_connector.py \
  --certificate /path/to/connector.crt --key /path/to/connector.key
```

The fixture reads `OPENJAM_EXTERNAL_AGENT_TOKEN` from its environment and listens on `127.0.0.1:8443` by default. Set `--host 0.0.0.0` inside an isolated Docker network to reach it from the Agent service. Configure the Agent to use `/openjam/generate` at the fixture address and add the signing CA to its trust bundle. The fixture generates results locally and works with synthetic credentials.

## Maintain workflow guides

Start with `agent/prompts/board-v1.json`. Each pack uses `schemaVersion: 1` and a `version` such as `1.0.0` or `1.1.0-beta`, with exactly `workshop`, `flowchart` and `organize` entries. Each workflow has up to 2,000 characters of `instructions` and one to eight `skills`. A skill has a unique ID within its workflow matching `^[a-z][a-z0-9-]{0,47}$` and up to 1,400 characters of `instructions`. Keep the complete UTF-8 JSON file at or below 48 KiB. These skill entries supply text guidance for draft generation. Policy, provider routing, capabilities and schema validation are enforced by the application.

To load a custom pack, mount its directory read-only into the Agent service and set `OPENJAM_AGENT_PROMPT_PACK` to the file's path in the container. For example, use this Compose override with a host directory named `prompt-packs`.

```yaml
services:
  agent:
    environment:
      OPENJAM_AGENT_PROMPT_PACK: /etc/openjam/prompts/board.json
    volumes:
      - ./prompt-packs:/etc/openjam/prompts:ro
```

Edit a complete candidate file, bump its version and validate it before replacing `board.json` with an atomic rename in the same host directory. From the repository root, replace `prompt-packs/board.next.json` with the candidate path as needed.

```bash
PYTHONPATH=agent python3 -B -c 'import sys; from prompt_packs import read_pack, parse_pack; print(parse_pack(read_pack(sys.argv[1])).version)' prompt-packs/board.next.json
mv prompt-packs/board.next.json prompt-packs/board.json
```

Each request uses one complete snapshot of the guide, including during a provider's schema repair. Missing, malformed, oversized and incomplete files leave the last valid snapshot active in that process. A fresh process starts with the bundled pack until it can load a valid mounted pack. Deploy the same file to every Agent replica for consistent guidance. To roll back, atomically restore the previous complete file.

Run the provider and pack contract tests with `python3 -B -m unittest discover -s agent -v`.
