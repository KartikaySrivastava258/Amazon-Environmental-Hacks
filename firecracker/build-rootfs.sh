#!/usr/bin/env bash
# Build firecracker/rootfs.ext4 from the agent container image, with an init script that brings up eth0 and runs
# the agent (AGENT_RUNTIME=firecracker). Needs sudo for the loop mount.
set -euo pipefail
cd "$(dirname "$0")/.."
CLI="${CONTAINER_CLI:-finch}"; command -v "$CLI" >/dev/null || CLI=docker
"$CLI" build -t punarnava/agent:local -f agent/Containerfile agent
CID="$("$CLI" create punarnava/agent:local)"
trap '"$CLI" rm "$CID" >/dev/null 2>&1 || true' EXIT
TAR="$(mktemp --suffix=.tar)"; "$CLI" export "$CID" -o "$TAR"
IMG=firecracker/rootfs.ext4; rm -f "$IMG"; truncate -s 2G "$IMG"; mkfs.ext4 -q "$IMG"
MNT="$(mktemp -d)"; sudo mount -o loop "$IMG" "$MNT"
sudo tar -xf "$TAR" -C "$MNT"
sudo tee "$MNT/sbin/pn-init" >/dev/null <<'INIT'
#!/bin/sh
# PID 1 inside the microVM: mount the basics, configure the network from the kernel ip= argument, run the agent.
mount -t proc proc /proc; mount -t sysfs sys /sys; mount -t devtmpfs dev /dev 2>/dev/null
ip link set lo up 2>/dev/null
echo "nameserver 1.1.1.1" > /etc/resolv.conf
export AGENT_RUNTIME=firecracker AGENT_HOST=0.0.0.0 AGENT_PORT=8790 OLLAMA_HOST=http://172.16.0.1:11434 PATH=/usr/local/bin:/usr/bin:/bin
cd /app && exec python service.py
INIT
sudo chmod +x "$MNT/sbin/pn-init"
sudo umount "$MNT"; rmdir "$MNT"; rm -f "$TAR"
echo "Built $IMG"
