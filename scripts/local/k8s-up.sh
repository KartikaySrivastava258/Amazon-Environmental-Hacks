#!/usr/bin/env bash
# Optional: run Punarnava on a local EKS Anywhere cluster (Docker provider; nodes run EKS Distro).
# Needs: eksctl + the EKS Anywhere plugin, kubectl, and Docker (EKS Anywhere's local provider uses Docker).
# Images are built with $CONTAINER_CLI (Finch by default) and imported into each node's containerd.
# Then: kubectl -n punarnava port-forward svc/app 8788:8787  ->  http://127.0.0.1:8788
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
for t in eksctl kubectl docker; do have "$t" || { echo "$t is required (see deploy/README.md)"; exit 1; }; done
mkdir -p .local-data/eksa
KCFG="$ROOT/.local-data/eksa/punarnava/punarnava-eks-a-cluster.kubeconfig"
if [ ! -f "$KCFG" ]; then
  say "Creating the EKS Anywhere cluster (several minutes)"
  (cd .local-data/eksa && eksctl anywhere create cluster -f "$ROOT/deploy/eks-anywhere/cluster.yaml")
fi
export KUBECONFIG="$KCFG"
BUILD="${CONTAINER_CLI:-finch}"; have "$BUILD" || BUILD=docker
say "Building images with $BUILD"
"$BUILD" build -t punarnava/app:local .
"$BUILD" build -t punarnava/opensearch-corretto:2.17.1 local/opensearch
"$BUILD" build -t punarnava/agent:local -f agent/Containerfile agent
say "Loading images into the cluster nodes"
for node in $(kubectl get nodes -o jsonpath='{.items[*].metadata.name}'); do
  for img in punarnava/app:local punarnava/opensearch-corretto:2.17.1 punarnava/agent:local; do
    "$BUILD" save "$img" | docker exec -i "$node" ctr -n k8s.io images import - >/dev/null
  done
done
say "Configuring"
kubectl apply -f deploy/k8s/namespace.yaml
kubectl -n punarnava get secret app-secret >/dev/null 2>&1 || kubectl -n punarnava create secret generic app-secret --from-literal=session-secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
kubectl -n punarnava create configmap localstack-init --from-file=local/localstack/init/ready.d/10-punarnava.sh --dry-run=client -o yaml | kubectl apply -f -
GW="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo 172.17.0.1)"
kubectl -n punarnava create configmap agent-config --from-literal=OLLAMA_HOST="http://$GW:11434" --from-literal=AGENT_MODEL="${AGENT_MODEL:-llama3.1:8b}" --dry-run=client -o yaml | kubectl apply -f -
# What the nodes actually run (EKS Distro builds carry "-eks-" in the kubelet version); shown on the Build It page.
DISTRO="$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion} on {.items[0].status.nodeInfo.osImage}')"
kubectl -n punarnava create configmap cluster-info --from-literal=PN_K8S_DISTRO="EKS Anywhere cluster, Kubernetes $DISTRO" --dry-run=client -o yaml | kubectl apply -f -
say "Deploying"
kubectl apply -k deploy/k8s
kubectl -n punarnava rollout status deploy/localstack --timeout=180s
kubectl -n punarnava rollout status statefulset/opensearch --timeout=300s
kubectl -n punarnava rollout status deploy/app --timeout=300s
kubectl get nodes -o wide
say "Ready. Open it with:  KUBECONFIG=$KCFG kubectl -n punarnava port-forward svc/app 8788:8787   then http://127.0.0.1:8788"
