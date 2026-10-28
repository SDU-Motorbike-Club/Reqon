#!/usr/bin/env bash
# Applies .github/rulesets/main.json to this repository's default branch: nobody can push straight to main,
# a change reaches it only through a pull request whose "gate (all checks green)" check passed on top of the
# current main, and main cannot be force-pushed or deleted. Repository admins may still merge a pull request
# past a red gate in an emergency (bypass_mode "pull_request": through a PR, never a direct push).
#
# Needs the GitHub CLI signed in as a repository admin. Run it once:   bash scripts/apply-branch-ruleset.sh
# Run it again later to update the rule from the file. It changes the shared repository's settings, so it is a
# person's decision and is not part of any workflow.
set -euo pipefail
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
file=.github/rulesets/main.json
name=$(jq -r .name "$file")
id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" | head -n1)
if [ -n "$id" ]; then
  echo "Updating ruleset $id on $repo"
  gh api -X PUT "repos/$repo/rulesets/$id" --input "$file" --jq '{id, name, enforcement}'
else
  echo "Creating the ruleset on $repo"
  gh api -X POST "repos/$repo/rulesets" --input "$file" --jq '{id, name, enforcement}'
fi
