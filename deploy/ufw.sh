#!/usr/bin/env bash
set -euo pipefail
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 443/tcp comment 'MC Panel HTTPS'
sudo ufw allow 25565/tcp comment 'Minecraft'
sudo ufw --force enable
sudo ufw status verbose
