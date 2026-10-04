#!/usr/bin/env bash
set -euo pipefail
if swapon --show --noheadings | grep -q .; then echo "Swap already exists; leaving it unchanged."; exit 0; fi
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
sudo sysctl vm.swappiness=10
