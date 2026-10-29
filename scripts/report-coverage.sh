#!/usr/bin/env bash
# Fail-closed signed coverage delivery. Required inputs are intentionally
# explicit so a producer can never report fabricated zeroes after parse failure.
set -euo pipefail

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require() { [ -n "${!1:-}" ] || fail "$1 is required"; }

require COVERAGE_SECRET
require REPO
require TEST_COUNT
require COVERAGE_PERCENT
require SOURCE_COMMIT_SHA
require COVERAGE_RUN_ID
require COVERAGE_WORKFLOW_REF
require SOURCE_TARGET_BRANCH

COVERAGE_PROVIDER="${COVERAGE_PROVIDER:-github-actions}"
SOURCE_REPOSITORY="${SOURCE_REPOSITORY:-${GITHUB_REPOSITORY:-$REPO}}"
COVERAGE_REPORTED_AT="${COVERAGE_REPORTED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
COVERAGE_ENDPOINT="${COVERAGE_ENDPOINT:-https://portfolio.thecreativetoken.com/api/coverage}"
COVERAGE_MAX_ATTEMPTS="${COVERAGE_MAX_ATTEMPTS:-3}"
COVERAGE_RETRY_DELAY_SECONDS="${COVERAGE_RETRY_DELAY_SECONDS:-2}"

case "$COVERAGE_MAX_ATTEMPTS" in ''|*[!0-9]*) fail "COVERAGE_MAX_ATTEMPTS must be a positive integer";; esac
[ "$COVERAGE_MAX_ATTEMPTS" -ge 1 ] || fail "COVERAGE_MAX_ATTEMPTS must be a positive integer"

BODY=$(REPO="$REPO" TEST_COUNT="$TEST_COUNT" TEST_FILES="${TEST_FILES:-}" \
  TESTS_PASSED="${TESTS_PASSED:-}" TESTS_FAILED="${TESTS_FAILED:-}" \
  COVERAGE_PERCENT="${COVERAGE_PERCENT:-}" COVERAGE_PROVIDER="$COVERAGE_PROVIDER" \
  SOURCE_REPOSITORY="$SOURCE_REPOSITORY" SOURCE_COMMIT_SHA="$SOURCE_COMMIT_SHA" \
  COVERAGE_REPORTED_AT="$COVERAGE_REPORTED_AT" COVERAGE_RUN_ID="$COVERAGE_RUN_ID" \
  COVERAGE_WORKFLOW_REF="$COVERAGE_WORKFLOW_REF" SOURCE_TARGET_BRANCH="$SOURCE_TARGET_BRANCH" \
  COVERAGE_ORIGIN="${COVERAGE_ORIGIN:-$(hostname)}" node <<'NODE'
const env = process.env;
const fail = (message) => { console.error(`ERROR: ${message}`); process.exit(1); };
const integer = (name, required = false) => {
  const raw = env[name];
  if (!raw && !required) return null;
  if (!/^(0|[1-9]\d*)$/.test(raw ?? "")) fail(`${name} must be a non-negative integer`);
  return Number(raw);
};
const numeric = (name) => {
  const raw = env[name];
  if (!raw || raw === "null") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) fail(`${name} must be null or between 0 and 100`);
  return value;
};
if (!/^[0-9a-fA-F]{40}$/.test(env.SOURCE_COMMIT_SHA ?? "")) fail("SOURCE_COMMIT_SHA must be a 40-character SHA");
if (!/^\d+$/.test(env.COVERAGE_RUN_ID ?? "")) fail("COVERAGE_RUN_ID must be numeric");
if (!(env.COVERAGE_WORKFLOW_REF ?? "").includes("@refs/heads/")) fail("COVERAGE_WORKFLOW_REF must identify a branch");
if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(env.SOURCE_TARGET_BRANCH ?? "")) fail("SOURCE_TARGET_BRANCH must identify a branch");
const reportedAt = new Date(env.COVERAGE_REPORTED_AT ?? "");
if (!Number.isFinite(reportedAt.getTime())) fail("COVERAGE_REPORTED_AT must be an ISO timestamp");
const testCount = integer("TEST_COUNT", true);
if (testCount === 0) fail("TEST_COUNT must be greater than zero for an applicable producer");
const payload = {
  repo: env.REPO,
  testCount,
  coveragePercent: numeric("COVERAGE_PERCENT"),
  testFiles: integer("TEST_FILES"),
  passing: integer("TESTS_PASSED"),
  failing: integer("TESTS_FAILED"),
  source: {
    provider: env.COVERAGE_PROVIDER,
    repository: env.SOURCE_REPOSITORY,
    runId: env.COVERAGE_RUN_ID,
    workflowRef: env.COVERAGE_WORKFLOW_REF,
    targetBranch: env.SOURCE_TARGET_BRANCH,
    commitSha: env.SOURCE_COMMIT_SHA,
    reportedAt: reportedAt.toISOString(),
    ...(env.COVERAGE_PROVIDER === "local-batch" ? { origin: env.COVERAGE_ORIGIN } : {}),
  },
};
process.stdout.write(JSON.stringify(payload));
NODE
) || fail "coverage payload validation failed"

SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$COVERAGE_SECRET" -hex | awk '{print $NF}')

attempt=1
while [ "$attempt" -le "$COVERAGE_MAX_ATTEMPTS" ]; do
  set +e
  HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$COVERAGE_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "X-Coverage-Signature-256: sha256=${SIGNATURE}" \
    --data-binary "$BODY")
  CURL_EXIT=$?
  set -e
  if [ "$CURL_EXIT" -eq 0 ] && [[ "$HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
    printf 'Coverage reported successfully (HTTP %s) for %s\n' "$HTTP_STATUS" "$REPO"
    exit 0
  fi

  retryable=false
  if [ "$CURL_EXIT" -ne 0 ] || [ "$HTTP_STATUS" = "408" ] || \
     [ "$HTTP_STATUS" = "425" ] || [ "$HTTP_STATUS" = "429" ] || \
     [[ "$HTTP_STATUS" =~ ^5[0-9][0-9]$ ]]; then
    retryable=true
  fi
  if [ "$retryable" != "true" ]; then
    fail "coverage delivery rejected with non-retryable HTTP ${HTTP_STATUS:-none}"
  fi

  printf 'Coverage delivery attempt %s/%s failed (curl=%s HTTP=%s)\n' \
    "$attempt" "$COVERAGE_MAX_ATTEMPTS" "$CURL_EXIT" "${HTTP_STATUS:-none}" >&2
  if [ "$attempt" -lt "$COVERAGE_MAX_ATTEMPTS" ]; then sleep "$COVERAGE_RETRY_DELAY_SECONDS"; fi
  attempt=$((attempt + 1))
done

fail "coverage delivery exhausted ${COVERAGE_MAX_ATTEMPTS} attempts"
