# Repository execution contract

## Instruction precedence

Follow instructions in this order:

1. The latest explicit `HUMAN → EXECUTOR` instruction.
2. The current `ORCHESTRATOR → EXECUTOR` handoff.
3. The active issue and unresolved review feedback.
4. Applicable nested `AGENTS.md` files.
5. This root `AGENTS.md`.
6. Surrounding code and repository conventions.

- A more specific instruction overrides a general rule only for the named action and current task.
- Issue-specific requirements override repository-wide rules. Nested instructions override this file only for files in their scope.
- A current human or orchestrator instruction may authorize a specific exception. Do not reject it because a lower-priority source contains a general prohibition.

## Platform support

- Treat Windows, macOS, and Linux as supported platforms.
- Keep shared source, configuration, scripts, paths, and tests portable unless an issue explicitly requires platform-specific behavior.
- Guard approved platform-specific code at the narrowest boundary. Do not introduce an operating-system assumption into shared behavior.
- Validate native integration proportionally on every affected supported platform.

## Scope and structure

- Build only what the active issue requires, including directly necessary tests, error handling, lifecycle handling, cleanup, and removal of superseded code.
- Follow surrounding code and repository conventions where higher-priority sources do not specify a detail. Preserve unrelated behavior.
- Follow YAGNI: do not add speculative options, hooks, wrappers, interfaces, extension points, configuration, infrastructure, or future-proofing.
- Do not add an abstraction until two real callers require it.
- Keep code that changes together in the same place. Prefer one cohesive file over fragments split only by size, and do not create a file when an existing file is its natural home.
- Do not leave dead code, unused exports, unreachable branches, or commented-out code.
- Do not add unrelated documentation, renames, formatting changes, dependency upgrades, or cleanup.

## Readability and errors

- Use the configured formatter and lint rules. Do not replace them without approval.
- Write maintained, readable source. Do not compress structured code or combine unrelated operations merely to reduce line count.
- Use clear names that state intent and side effects. Keep one level of abstraction in each function.
- Do not mix input handling, business rules, and input/output work in one dense function. Prefer direct control flow and explicit results over implicit shared state.
- Explain only non-obvious reasons, ordering, constraints, or workarounds in comments. Do not restate the code.
- Validate at system boundaries. Fail clearly where invalid input or state can be described, and preserve useful error context.
- Do not suppress failures, log and rethrow without adding context, or add unrequested fallback behavior.

## Dependencies

- Dependencies already recorded in repository manifests and lockfiles are the approved baseline.
- A new runtime, development, Rust, CI-action, or system dependency requires explicit approval from the active issue, unresolved review feedback, or a higher-priority instruction.
- Stop and report before adding a dependency outside that approval. Do not substitute a similar package or tool to bypass the approval boundary.
- Use the repository's existing package manager and commit corresponding lockfile changes when an approved dependency changes.

## Tests and validation

- The executor owns test quality and proportional repository-native validation. Do not defer automatable validation to a human.
- Write or update tests required by the active issue, and demonstrate a relevant failing test before implementation when practical.
- Test observable behavior at the narrowest stable boundary. Do not test private helpers, framework internals, generated code, hypothetical behavior, or duplicate paths.
- Do not mock the unit under test. Do not weaken, skip, ignore, delete, or change a test only to make an implementation pass.
- Run focused headless checks while implementing and all relevant repository-native gates for the executor host before pushing.
- Treat continuous integration as the authoritative native validation for supported platforms not represented by the executor host.
- Do not introduce command wrappers, coverage services, or another test framework merely to normalize validation.

## Build, installation, and machine safety

- Focused headless builds and tests are allowed.
- Do not package or install an application unless the active issue or a higher-priority instruction explicitly authorizes the target platform and timing.
- Do not launch the application or control its interface. Installation authorization does not imply launch authorization.
- Do not use graphical automation, simulated input, browser or operating-system automation, persistent development servers, watchers, or background processes.
- Keep packaging and installation within the explicitly authorized platform scope; do not produce or install builds for other platforms.
- Stop before an unexpected privilege prompt, graphical interaction, credential request, security bypass, destructive action, or unsupported environment change.

## Pull requests and human verification

- Use one branch and one pull request per issue. Keep requested corrections on that branch and pull request, and keep unrelated changes out.
- Put exactly one `Fixes #N` in the pull-request description, where `N` is the active issue number.
- Normally complete one coherent local work round before pushing. Use concise, objective technical language and keep routine output in command or CI logs.
- Report blocking human verification separately from deferred cosmetic verification. State precisely what remains and do not present deferred cosmetic verification as a blocker.

## Executor response protocol

Routine status begins with:

> **EXECUTOR → HUMAN**

A question that blocks work begins with:

> **EXECUTOR → HUMAN — ACTION REQUIRED**

Use `ACTION REQUIRED` only when work cannot continue without a human decision.

A completion or blocker handoff must be one fenced block beginning with `EXECUTOR → ORCHESTRATOR` and include only:

- Repository.
- Issue and pull-request numbers.
- Branch.
- Latest commit.
- Continuous-integration state for Windows, macOS, and Linux.
- Unresolved feedback.
- Uncovered requirements.
- Whether blocking human verification remains necessary.
- Any deferred visual-verification item.
- Installation state: not authorized, not required, succeeded, or failed.
- Installed commit or version when installation succeeded.
- Installation blocker when installation failed.
- Whether the queue is complete or blocked.
- The blocker when blocked.

Exclude implementation summaries, routine command output, repository history, and optional suggestions.
