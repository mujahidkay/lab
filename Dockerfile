# lab runtime image. Holds ONLY the toolchain (node, yarn, git, gh, cloudflared,
# claude). The lab code + per-repo state are bind-mounted at /lab by `labctl`,
# so one image serves every instance and code edits need no rebuild.
FROM node:22-bookworm

ARG LAB_UID=1000
ARG LAB_GID=1000

# System tools: git, gh, cloudflared, jq, less, gosu (to drop root -> lab).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates gnupg jq less gosu \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && arch="$(dpkg --print-architecture)" \
  && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" \
       -o /usr/local/bin/cloudflared \
  && chmod +x /usr/local/bin/cloudflared \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Yarn 4 (corepack) + the Claude Code CLI.
RUN corepack enable && npm install -g @anthropic-ai/claude-code

# A user matching the host UID/GID so bind-mounted files stay writable.
RUN if ! getent group "${LAB_GID}" >/dev/null; then groupadd -g "${LAB_GID}" labgrp; fi \
 && useradd -m -u "${LAB_UID}" -g "${LAB_GID}" -s /bin/bash lab

# Entrypoint runs as root: fix ownership of the (root-owned) named-volume mount
# points, then drop to the lab user. `docker exec` calls pass `-u lab` directly.
RUN printf '%s\n' \
  '#!/bin/bash' \
  'set -e' \
  'for d in /home/lab/.claude /lab/node_modules; do mkdir -p "$d" 2>/dev/null || true; chown lab "$d" 2>/dev/null || true; done' \
  'exec gosu lab "$@"' \
  > /usr/local/bin/lab-entrypoint && chmod +x /usr/local/bin/lab-entrypoint

ENV HOME=/home/lab
ENV LAB_CONTAINER=1
WORKDIR /lab
ENTRYPOINT ["/usr/local/bin/lab-entrypoint"]
CMD ["sleep", "infinity"]
