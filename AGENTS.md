# Repository execution contract

## Instruction priority

Follow instructions in this order: the latest explicit human instruction, the current orchestrator handoff, the active issue and unresolved review feedback, applicable nested `AGENTS.md` files, this file, and surrounding code. A more specific instruction overrides a general one only for the named task.

## Platform support

- Treat Windows, macOS, and Linux as supported platforms.
- Keep shared source, configuration, scripts, paths, and tests portable unless an issue explicitly requires platform-specific behavior.
- Guard approved platform-specific code at the narrowest boundary and validate native integration proportionally on every affected supported platform.

## Scope and implementation

- Build only what the active issue requires, including directly necessary tests, error handling, cleanup, and removal of superseded code.
- Preserve unrelated behavior. Do not add speculative abstractions, extension points, infrastructure, documentation, upgrades, or cleanup.
- Keep code that changes together in the same place. Do not create a new file when an existing file is its natural home, and do not leave dead code or commented-out code.
- Use configured formatters and lint rules. Prefer clear names, direct control flow, and comments that explain only non-obvious constraints or reasons.
- Validate at system boundaries, fail clearly, and preserve useful error context.
- Do not add a dependency unless the active issue directly requires it or a higher-priority instruction approves it.

## Tests and validation

- Add or update the tests required by the active issue and demonstrate a relevant failure before implementation when practical.
- Test observable behavior at the narrowest stable boundary. Do not mock the unit under test or weaken checks to make a change pass.
- Run focused headless checks while implementing and all relevant repository-native gates before pushing.
- Use continuous integration as the authoritative native validation for supported platforms not represented by the executor host.

## Machine safety

- Do not launch the application, automate a graphical interface, run persistent development processes, or install an application unless a current issue or higher-priority instruction explicitly authorizes it.
- Stop before an unexpected privilege prompt, credential request, security bypass, destructive action, or unsupported environment change.

## Pull requests and communication

- Use one branch and one pull request per issue. Keep unrelated changes out and apply requested review changes to the same pull request.
- Use concise, objective technical language and report any remaining human or visual verification explicitly.
- Routine executor status begins with `EXECUTOR → HUMAN`; blocking questions add `— ACTION REQUIRED`.
- A completion or blocker handoff is one fenced block beginning with `EXECUTOR → ORCHESTRATOR`. Include only the repository, issue and pull-request numbers, branch, latest commit, CI state for Windows/macOS/Linux, unresolved feedback, uncovered requirements, blocking human verification, deferred visual verification, installation state and installed commit/version or blocker, queue state, and blocker when blocked.
