#!/usr/bin/env bash
# Boot the agent microVM: tap0 (172.16.0.1/30) <-> guest eth0 (172.16.0.2), agent on http://172.16.0.2:8790.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--down" ]; then sudo ip link del tap0 2>/dev/null || true; echo "tap0 removed"; exit 0; fi
[ -e /dev/kvm ] || { echo "/dev/kvm not found: Firecracker needs KVM"; exit 1; }
command -v firecracker >/dev/null || { echo "firecracker binary not on PATH"; exit 1; }
[ -f firecracker/rootfs.ext4 ] || { echo "Run firecracker/build-rootfs.sh first"; exit 1; }
: "${KERNEL:?Set KERNEL=/path/to/vmlinux (see firecracker/README.md)}"
if ! ip link show tap0 >/dev/null 2>&1; then
  sudo ip tuntap add tap0 mode tap user "$(id -u)"
  sudo ip addr add 172.16.0.1/30 dev tap0
  sudo ip link set tap0 up
fi
CFG="$(mktemp --suffix=.json)"; sed "s#KERNEL_PATH#$KERNEL#" firecracker/vm-config.json > "$CFG"
echo "Booting the agent microVM; the agent will answer on http://172.16.0.2:8790/health"
exec firecracker --no-api --config-file "$CFG"
