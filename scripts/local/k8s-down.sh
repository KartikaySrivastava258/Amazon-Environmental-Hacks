#!/usr/bin/env bash
# Remove Punarnava from the EKS Anywhere cluster; with --cluster also delete the cluster.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
export KUBECONFIG="$ROOT/.local-data/eksa/punarnava/punarnava-eks-a-cluster.kubeconfig"
kubectl delete -k deploy/k8s --ignore-not-found
if [ "${1:-}" = "--cluster" ]; then (cd .local-data/eksa && eksctl anywhere delete cluster -f "$ROOT/deploy/eks-anywhere/cluster.yaml"); fi
