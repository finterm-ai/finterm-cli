# Contributing

Use the normal GitHub pull request flow.
Before opening a pull request, run:

```bash
pnpm ci
```

Keep changes within the public CLI boundary.
Do not add internal Finterm engine code, provider credentials, private operational docs,
or unpublished API surfaces.

## Releases

Agents must not publish the npm package.
Publishing requires explicit human approval, npm ownership setup, provenance/trusted
publishing review, and a passing release dry run.

<!-- This document follows common-doc-guidelines.md.
See github.com/jlevy/practical-prose and review guidelines before editing.
-->
