#!/usr/bin/env bash
set -euo pipefail
# Review SSH access before enabling UFW to avoid locking yourself out.
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw allow 25565/tcp
sudo ufw --force enable
sudo ufw status verbose
