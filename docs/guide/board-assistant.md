# Board assistant

Open the assistant from the board's three-dot menu. A board or organization owner can enable it and select a deployment-configured model. The initial workflows create a workshop, draw a flowchart, or organize selected notes. All three produce editable objects. Choose a new page or space on the current page before generating.

## Draft and collaborate

1. Describe the board in natural language. For example, ask for a 45-minute retrospective with an opening check-in and an action-items group. For a cloud model or external Agent, confirm the prompt and the selected text, if any, before submitting.
2. Follow the conversation timeline for the request, recorded job states, any clarification, and the result. When the assistant requests clarification, answer once to continue the same run. A source-labeled Markdown reply from an external connector appears separately from the editable proposal.
3. Inspect the structured preview and replay its placement in the canvas rehearsal. On the current page, translucent draft objects also show where the draft will land. The preview has no document revision and is visible to the initiator.
4. Select **Apply draft**. The server commits the entire draft in a single edit and rechecks board access, policy, and selected input. Generated objects show the user's name and assistant name in the attribution badge. Select **Undo draft** while that application is still your most recent undoable edit. The editor checks the affected objects before undoing.

The timeline shows public task states and draft actions. Recorded requests and results survive page reload within the run's retention window. The full list of transitions in a timeline comes from the states that panel observed.

## Run controls and sharing

| Control | Behavior |
| --- | --- |
| Pause | Holds a queued run. For an active local run, fences the worker lease and discards any subsequent output from that attempt |
| Resume | Rechecks access and source revisions, then requeues the same run and keeps its original deadline |
| Stop | Marks the run stopped and prevents subsequent results from being published. A provider may finish an already dispatched request |
| Share conversation | Publishes a read-only snapshot for the board owner and named board members |
| Stop sharing | Revokes the snapshot. Access is checked on each read and again while the shared panel remains open |

An already dispatched cloud request continues so resuming cannot cause a duplicate paid request. A run based on selected board text publishes only the user-authored prompt and any answer already recorded. Other published runs can include the clarification, proposal summary, and external response. Future answers and changes to a published run stay in its private history until the owner publishes a new snapshot. The conversation and its share expire 24 hours after run creation.

## Customize your assistant

Open **Assistant character** from the assistant header. The default is an animated hollow ring. You can name it, choose a monochrome glyph, or import PNG, WebP, or JPEG artwork. Standard images are normalized to 48 px. The original file stays in your browser.

For artwork designed in ChatGPT or another character design tool, export a square PNG or WebP. Transparent backgrounds, a centered silhouette, and no text make it readable at toolbar size. Import a character exported from Meta Muse through the same image path when its export is PNG, WebP, or JPEG.

To import from ChatGPT Pets, download the pet's sprite sheet and select its PNG or WebP file. The importer recognizes the 1536×1872 and 1536×2288 layouts. It extracts six frames each for idle, working, waiting, and reviewing, and previews each state before saving. Browsers with reduced motion enabled display the first frame. The normalized appearance is stored per OpenJam account. Collaborators see the name and any selected glyph on attributed objects. Original artwork and sprite files stay outside the board document and provider requests.

## Configure an external Agent or update guidance

Deploy a version 1 HTTPS adapter to connect an organization-authorized Agent. Its structured proposal goes through the same preview and confirmation flow. Use the shipped workflow pack to update instructions and skill guidance for workshops, flowcharts, and note organization. The Agent service atomically adopts a complete valid pack and retains the previous pack if an update is invalid. [External Agent and workflow guides](/guide/agent-connector)
