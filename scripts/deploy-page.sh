#!/usr/bin/env bash
# Deploy the judges' page: the approved snapshot, the officer's files and /api/voice/* in one Cloud Run service.
# Staged into a scratch directory so the upload holds exactly what the container needs (the repo's .gcloudignore keeps
# the snapshot out of API-only deploys). Needs .env with ASSEMBLYAI_API_KEY, OFFICER_LLM_KEY, OFFICER_AGENT_ID.
#   scripts/deploy-page.sh [service=bridge-voice] [project=hyperdrift-distribution] [region=europe-west1]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"; service="${1:-bridge-voice}"; project="${2:-hyperdrift-distribution}"; region="${3:-europe-west1}"
[ -f "$here/public/index.html" ] || { echo "public/index.html is missing: build the snapshot first (scripts/build-demo.mjs)"; exit 1; }
set -a; . "$here/.env"; set +a
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/scripts"
cp "$here/package.json" "$here/Dockerfile" "$stage/"
cp -R "$here/api" "$here/fixtures" "$here/public" "$stage/"
cp "$here/scripts/dev.mjs" "$stage/scripts/"
gcloud run deploy "$service" --source "$stage" --clear-base-image --project "$project" --region "$region" --allow-unauthenticated --max-instances 2 \
  --set-env-vars "ASSEMBLYAI_API_KEY=$ASSEMBLYAI_API_KEY,OFFICER_LLM_KEY=$OFFICER_LLM_KEY,OFFICER_AGENT_ID=${OFFICER_AGENT_ID:-},CREW_API=0" --quiet
