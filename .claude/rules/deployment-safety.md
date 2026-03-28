---
description: Production deployment safety -- main is production, Dependabot handling, cost awareness, rollback-first
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

- **Merging to `main` IS deploying to production.**
  Every merge triggers a production deployment.
- **Dependabot PRs target `main` by default.**
  Never merge directly. Cherry-pick to `develop`,
  close the PR, release normally.
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
