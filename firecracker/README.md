# Strands agent in a Firecracker microVM (optional)

Why: the agent runs model-driven tool calls. Running it in a Firecracker microVM (its own kernel, a minimal
virtual machine, KVM isolation) keeps that work apart from the Punarnava server and your laptop. The app talks to
it over a private tap network and still re-checks every answer (backend/src/core/assist.js).

Needs: Linux x86_64 with KVM (`ls /dev/kvm`), sudo (for the tap device), Finch (or Docker) to build the agent
image, `e2fsprogs`, the Firecracker binary (https://github.com/firecracker-microvm/firecracker/releases) and an
uncompressed guest kernel (`vmlinux`) as described in Firecracker's getting-started guide. Ollama on the host
must listen on the tap address: `OLLAMA_HOST=0.0.0.0 ollama serve`.

    firecracker/build-rootfs.sh        # agent image -> firecracker/rootfs.ext4 (with /sbin/pn-init)
    KERNEL=/path/to/vmlinux firecracker/run.sh   # tap0 172.16.0.1 <-> guest 172.16.0.2, agent on :8790

Then start the app so the agent can reach it and it can reach the agent:

    PN_HOST=0.0.0.0 PN_TOOLS_BASE=http://172.16.0.1:8787 AGENT_URL=http://172.16.0.2:8790 scripts/local/start.sh

The Build It stack page then shows the agent's runtime as "firecracker" (reported by the agent itself).
Stop the VM with Ctrl+C in its terminal; `firecracker/run.sh --down` removes tap0.
