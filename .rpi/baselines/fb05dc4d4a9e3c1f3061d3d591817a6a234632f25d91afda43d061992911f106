---
description: Production deployment safety -- protected production branch, Dependabot handling, cost awareness, rollback-first
paths:
  - .github/**
  - deploy/**
  - Dockerfile
  - docker-compose*
  - vercel.json
  - netlify.toml
  - fly.toml
  - "**/deployment/**"
  - "**/infrastructure/**"
---

# Deployment Safety

- **Merging to the protected production branch IS deploying to
  production.**
  In many repos that branch is `main`, but check the documented
  topology first.
- **Dependabot PRs often target the production branch by default.**
  Never merge directly. Move updates onto the non-production integration
  path locally, verify the combined update, and release through the normal flow.
  Closing or commenting on external PRs requires authorization.
- **Every CI run and deployment costs money.**
  Working branches stay local. Run the full local gate and integrate locally
  before one authorized integration push; inspect triggers first.
- **Never create Vercel Previews.** Verify framework upgrades with local builds,
  runtime tests and deployment preflight. Read existing deployment logs when
  needed; record platform-only uncertainty before an authorized release.
- **When production is down:** Restore the known-good release under the
  project's authorized incident procedure.
  Investigate from existing logs and local reproductions. Never deploy to diagnose.
- **Batch dependency updates** into a single local branch.
  Never merge N PRs one-by-one (O(n^2) CI waste).
- **Justify every external action** --
  before any CI run, deployment, or API call:
  Is this needed? Is this justified? Is this verifiable?

For full deployment procedures and rollback protocols,
see the deployment-safety skill.
