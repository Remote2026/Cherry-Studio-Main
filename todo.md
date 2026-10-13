# RagFlow Knowledge Base Integration

## Decisions

- RagFlow is the remote knowledge base provider.
- Cherry Studio does not build or store a second local RagFlow knowledge base.
- RagFlow handles document parsing, chunking, embedding, vector storage, retrieval, and reranking.
- Cherry Studio keeps its application SQLite database for chats, assistants, preferences, and integration configuration.
- Local knowledge-base support remains intact during the first implementation phase and is bypassed only for RagFlow-backed knowledge bases.

## Action Items

### 0. Repository Baseline

- [x] Configure a usable GPG signing environment.
- [x] Commit the current repository baseline with `git commit -S --signoff`.
- [x] Verify the commit contains both `gpgsig` and `Signed-off-by`.

### 1. RagFlow Configuration UI

- [x] Add a user-facing RagFlow settings page under the application settings area.
- [x] Add a service address field with `http://localhost` as the initial default.
- [x] Add an API Key password field with show/hide control.
- [x] Add a Save action.
- [ ] Add a connection-test action through the main-process RagFlow client.
- [x] Add clear validation for an invalid URL and an empty API Key.
- [ ] Display actionable errors for connection failure, unauthorized access, and unavailable RagFlow service.
- [x] Load the saved configuration when the page is opened.
- [ ] Keep the API Key out of renderer network requests, logs, exports, and error messages.
- [x] Store the configuration through the existing application preference/configuration boundary.
- [ ] Ensure the API Key is redacted in diagnostics and serialized configuration output.

### 2. RagFlow API Client

- [ ] Implement a main-process RagFlow client using the configured service address and API Key.
- [ ] Support `GET /api/v1/datasets` for dataset listing.
- [ ] Support `GET /api/v1/datasets/{id}/documents` for document listing.
- [ ] Support `POST /api/v1/retrieval` for retrieval testing and chat search.
- [ ] Send `Authorization: Bearer <RAGFLOW_API_KEY>` from the main process.
- [ ] Normalize RagFlow responses into the existing knowledge-base result and citation shapes.
- [ ] Handle HTTP errors, malformed responses, timeouts, and service unavailability consistently.

### 3. Knowledge UI Reuse

- [ ] Add a RagFlow/local knowledge source selector to the existing knowledge workflow.
- [ ] Reuse the current knowledge-base list UI to display RagFlow datasets.
- [ ] Reuse the current data-source UI to display RagFlow documents.
- [ ] Reuse the recall-test UI to call RagFlow retrieval.
- [ ] Display document name, content snippet, score, and source metadata.
- [ ] Hide local embedding, chunking, indexing, and local upload controls for RagFlow datasets.
- [ ] Keep RagFlow dataset management read-only in the first phase; manage documents in RagFlow itself.

### 4. Chat and Assistant Integration

- [ ] Add an explicit knowledge source marker for `local` and `ragflow`.
- [ ] Persist the selected RagFlow dataset IDs with the relevant assistant/chat configuration.
- [ ] Route RagFlow-backed searches to the RagFlow retrieval endpoint.
- [ ] Reuse the existing knowledge result, citation, and message rendering components.
- [ ] Ensure changing the selected dataset changes the retrieval scope.
- [ ] Prevent RagFlow dataset IDs from being passed to the local `KnowledgeService`.

### 5. Local RAG Scope

- [ ] Do not invoke the local embedding model for RagFlow-backed knowledge bases.
- [ ] Do not create or update local `index.sqlite` or vector records for RagFlow-backed knowledge bases.
- [ ] Keep application SQLite because it stores unrelated Cherry Studio business data.
- [ ] Do not remove the existing local knowledge-base implementation until RagFlow mode is verified in production-like use.
- [ ] Reassess removal of local embedding and vector-store dependencies after the migration period.

### 6. Tests and Verification

- [ ] Test UI loading, editing, saving, and reloading of RagFlow configuration.
- [ ] Test API Key masking and redaction.
- [ ] Test successful dataset listing and retrieval.
- [ ] Test unauthorized, unreachable, timeout, and malformed-response failures.
- [ ] Test local and RagFlow knowledge sources do not cross-call each other's storage or APIs.
- [ ] Test citations and source metadata in chat output.
- [ ] Run focused unit and renderer tests.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm i18n:check`.
- [ ] Run the affected checks with `pnpm check --plan` and `pnpm check`.

## Acceptance Criteria

- A user can configure the RagFlow service address and API Key entirely through the UI.
- The API Key is never hardcoded, exposed in renderer requests, or written to logs.
- A configured user can see RagFlow datasets and run a retrieval test from Cherry Studio.
- Chat retrieval uses RagFlow without creating local documents, embeddings, or vector indexes.
- Existing local knowledge bases continue to work during the migration period.
