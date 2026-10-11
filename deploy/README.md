# Optional deployments on your machine

| Folder | Tool | What it does |
|---|---|---|
| `eks-anywhere/cluster.yaml` | EKS Anywhere (Docker provider) | creates a local Kubernetes cluster whose nodes run **EKS Distro** |
| `k8s/` | Kubernetes manifests (kustomize) | app, LocalStack, OpenSearch on Corretto, Strands agent, volumes, probes |

    scripts/local/k8s-up.sh          # create the cluster (first time), build images with Finch, load them, deploy
    KUBECONFIG=.local-data/eksa/punarnava/punarnava-eks-a-cluster.kubeconfig kubectl -n punarnava port-forward svc/app 8788:8787
    # open http://127.0.0.1:8788 -> "Built with" shows EKS Anywhere / EKS Distro as active, with the node's Kubernetes build
    scripts/local/k8s-down.sh [--cluster]

Needs: `eksctl` with the EKS Anywhere plugin, `kubectl`, and Docker (EKS Anywhere's local provider runs its nodes as
Docker containers). Allow ~8 GB RAM. Developer controls (Reset, Skip) are off in the cluster; use the persona bar.
`scripts/local/verify.sh` checks the cluster tooling on your machine and reports what it finds.
