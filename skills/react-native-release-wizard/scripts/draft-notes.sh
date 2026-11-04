#!/usr/bin/env bash
# Copyright Elastic Technologies Inc. and/or licensed to
# Elastic Technologies Inc. under one or more contributor license
# agreements. See the NOTICE file distributed with this work for
# additional information regarding copyright ownership.
# Elastic Technologies Inc. licenses this file to you under the Apache
# License, Version 2.0 (the "License"); you may not use this file except
# in compliance with the License. You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

#
# Draft EDOT React Native release-note JSON by dispatching the Draft release notes
# workflow on a release ref and printing the JSON it attaches to its run.
#
# Usage: draft-notes.sh <ref>
#
# Arguments:
#   ref  branch the release is prepared from: main or patching/x.y.z
#
# The workflow drafts from the same range Prepare release uses for that
# branch. This script runs it through dispatch.sh, downloads the run's
# `release-notes` artifact into a temporary directory outside the
# repository, prints the JSON on standard output, and removes the directory.
# Progress goes to standard error. It writes nothing to the repository.
#
# Exit status: 0 when the JSON is printed; 1 otherwise, with the run URL on
# standard error when there is a run; 2 on a usage error.

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=repository.sh
source "$script_dir/repository.sh"

if [[ $# -ne 1 || -z $1 ]]; then
  echo "Usage: draft-notes.sh <ref>" >&2
  exit 2
fi
ref=$1

run=$("$script_dir/dispatch.sh" draft-release-notes.yml "$ref") || exit 1
run_id=${run%% *}
run_url=${run#* }

notes_dir=$(mktemp -d)
trap 'rm -rf "$notes_dir"' EXIT

if ! gh run download "$run_id" --repo "$repository" --name release-notes \
  --dir "$notes_dir" >&2; then
  echo "Could not download the release-notes artifact of the run: $run_url" >&2
  exit 1
fi
jq . "$notes_dir/release-notes.json"
