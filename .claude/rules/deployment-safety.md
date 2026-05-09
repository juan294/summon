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
  path, close the original PR, and release through the normal flow.
- **Every CI run and deployment costs money.**
  Estimate runs/deploys before starting.
  If more than 2-3, batch the work.
- **Framework upgrades require preview verification.**
  CI passing is NOT sufficient.
  Deploy to preview and verify before merging.
- **When production is down:** Roll back immediately.
  Investigate on non-production. Never deploy to diagnose.
- **Batch dependency updates** into a single branch/PR.
  Never merge N PRs one-by-one (O(n^2) CI waste).
- **Justify every external action** --
  before any CI run, deployment, or API call:
  Is this needed? Is this justified? Is this verifiable?

For full deployment procedures and rollback protocols,
see the deployment-safety skill.
