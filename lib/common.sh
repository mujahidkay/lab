# lib/common.sh — shared helpers for the lab's bin/ scripts.
# SOURCE this file; do not execute it. Requires bash.
# Hard rule: nothing in bin/ ever prompts on stdin (no `read`). The lab must
# never block a human on a terminal; questions go to the whiteboard instead.

# Resolve LAB_ROOT as the parent of this lib/ directory, regardless of CWD.
_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_ROOT="$(cd "$_lib_dir/.." && pwd)"
export LAB_ROOT

# Load config.env (if present) into the environment.
if [ -f "$LAB_ROOT/config.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$LAB_ROOT/config.env"
  set +a
fi

# Canonical paths.
DOCKET="$LAB_ROOT/docket"
NOTEBOOK="$LAB_ROOT/notebook"
WHITEBOARD="$LAB_ROOT/whiteboard"
WORKTREES="$LAB_ROOT/worktrees"
PROJECT="$LAB_ROOT/project"
DOTLAB="$LAB_ROOT/.lab"
export DOCKET NOTEBOOK WHITEBOARD WORKTREES PROJECT DOTLAB

# Defaults (config.env overrides these).
: "${DASH_HOST:=127.0.0.1}"
: "${DASH_PORT:=8787}"
: "${GATE_MODE:=solo}"
: "${TUNNEL:=none}"
: "${ACTIVE_MIN:=60}"
: "${ACTIVE_MAX:=1800}"
: "${IDLE_MIN:=1800}"
: "${IDLE_MAX:=3600}"
: "${DEFAULT_BRANCH:=main}"

# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------

die()      { printf 'lab: %s\n' "$*" >&2; exit 1; }
warn()     { printf 'lab: %s\n' "$*" >&2; }
have()     { command -v "$1" >/dev/null 2>&1; }

# UTC timestamps.
#   ts_id  -> 20260708T140233Z   (filesystem-safe, sortable; used in ids/paths)
#   ts_iso -> 2026-07-08T14:02:33Z (frontmatter `ts:` value)
ts_id()  { date -u +%Y%m%dT%H%M%SZ; }
ts_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# A short random hex token (default 4 bytes -> 8 hex chars), portable.
# NB: `head` is the bounded reader of the device (so nothing upstream gets
# SIGPIPE); piping `tr </dev/urandom | head` instead would kill `tr` with
# SIGPIPE and, under `set -e -o pipefail`, abort the caller.
rand_hex() {
  local n="${1:-4}"
  if [ -r /dev/urandom ]; then
    head -c "$n" /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    # Fallback: derive from time + pid (weaker, but never used if urandom exists).
    printf '%0*x' $((n * 2)) $(( ($(date +%s) * 7919 + $$) & 0xffffffff ))
  fi
}

# Readable element word for human-friendly ids.
_LAB_ELEMENTS="argon boron carbon neon oxygen helium xenon radon iron zinc gold lead tin copper silver cobalt nickel sodium sulfur iodine cesium barium cerium erbium indium osmium cobalt radium yttrium hafnium"
rand_element() {
  # shellcheck disable=SC2086
  set -- $_LAB_ELEMENTS
  local count=$# idx word
  idx=$(( ( 0x$(rand_hex 2) % count ) + 1 ))
  eval "word=\${$idx}"
  printf '%s' "$word"
}

# slugify STRING -> lowercase kebab, alnum only, collapsed, max ~48 chars.
slugify() {
  printf '%s' "$1" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-*//' -e 's/-*$//' \
    | cut -c1-48
}

# new_job_id -> <ts_id>-<element>, guaranteed unique across all docket states.
new_job_id() {
  local id
  while :; do
    id="$(ts_id)-$(rand_element)"
    if ! ls "$DOCKET"/*/"$id".md >/dev/null 2>&1; then
      printf '%s' "$id"
      return 0
    fi
  done
}

# ---------------------------------------------------------------------------
# YAML frontmatter helpers (simple `key: value` blocks between the first two
# `---` lines). Values may be quoted; get strips one layer of quotes.
# ---------------------------------------------------------------------------

# fm_get FILE KEY -> value on stdout ("" if absent).
fm_get() {
  local file=$1 key=$2
  awk -v k="$key" '
    BEGIN { infm = 0; seen = 0 }
    /^---[[:space:]]*$/ {
      if (!seen) { seen = 1; infm = 1; next }
      else if (infm) { infm = 0; next }
    }
    infm && index($0, k ":") == 1 {
      v = $0
      sub("^" k ":[[:space:]]*", "", v)
      gsub(/^"|"$/, "", v)
      print v
      exit
    }
  ' "$file"
}

# fm_set FILE KEY VALUE -> replace KEY in frontmatter, or insert before closing ---.
fm_set() {
  local file=$1 key=$2 val=$3 tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    BEGIN { infm = 0; seen = 0; done = 0 }
    /^---[[:space:]]*$/ {
      if (!seen) { seen = 1; infm = 1; print; next }
      else if (infm) {
        if (!done) { print k ": " v; done = 1 }
        infm = 0; print; next
      }
    }
    {
      if (infm && index($0, k ":") == 1) {
        if (!done) { print k ": " v; done = 1 }
        next
      }
      print
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# body_of FILE -> everything after the second `---` line.
body_of() {
  awk '
    BEGIN { infm = 0; seen = 0; body = 0 }
    /^---[[:space:]]*$/ {
      if (!seen) { seen = 1; infm = 1; next }
      else if (infm) { infm = 0; body = 1; next }
    }
    body { print }
  ' "$1"
}

# ---------------------------------------------------------------------------
# Atomic file move. Returns non-zero if the source is gone (lost a claim race).
# `mv` within one filesystem is atomic; the loser's mv fails because the source
# no longer exists.
# ---------------------------------------------------------------------------
atomic_mv() {
  local src=$1 dst=$2
  [ -e "$src" ] || return 1
  mv -n "$src" "$dst" 2>/dev/null || return 1
  # mv -n leaves the source in place if dst existed; verify the move happened.
  [ ! -e "$src" ] && [ -e "$dst" ]
}

# env_set FILE KEY VALUE — set or append KEY=VALUE in a KEY=VALUE env file.
env_set() {
  local file=$1 key=$2 val=$3 tmp
  [ -f "$file" ] || : > "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" '
      index($0, k "=") == 1 { print k "=" v; next }
      { print }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}
