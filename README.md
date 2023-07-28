# Use Case: Popular Pages on Web Site

## Documentation

Goal of this application is to rank the subpages of a website by popularity.
By underlying the webpage with a big-data architecture the functionality is easily scaleable and extendable.

A cache-server is used to manage load and Spark on Hadoop handles the data processing.
For storage a mariadb-server is used.

By utilizing batch-processing a lambda-architecture is built to handle even big income of data.

## Installation

Install necessary packages:

```
sudo apt update
sudo apt install -y apt-transport-https wget gpg
```

Install docker:

```
sudo apt install -y docker.io
sudo usermod -aG docker $USER && newgrp docker
```

Install minikube:

```
wget https://storage.googleapis.com/minikube/releases/latest/minikube_latest_amd64.deb
sudo dpkg -i minikube_latest_amd64.deb
```

Install kubectl:

```
wget -O - https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-archive-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-archive-keyring.gpg] https://apt.kubernetes.io/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt update
sudo apt install -y kubectl
```

Install Helm:

```
wget -O - https://baltocdn.com/helm/signing.asc | sudo gpg --dearmor -o /etc/apt/keyrings/helm.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
sudo apt update
sudo apt install helm
```

Start minikube:

```
minikube start --cpus=4 --memory=8000MB --addons=ingress
```

Install Strimzi Operator and Kafka Cluster:

```
helm repo add strimzi http://strimzi.io/charts/
helm install my-kafka-operator strimzi/strimzi-kafka-operator
kubectl apply -f https://farberg.de/talks/big-data/code/helm-kafka-operator/kafka-cluster-def.yaml
```

Install Hadoop:

```
helm repo add pfisterer-hadoop https://pfisterer.github.io/apache-hadoop-helm/
helm install my-hadoop-cluster pfisterer-hadoop/hadoop --set hdfs.dataNode.replicas=1 --set yarn.nodeManager.replicas=1
```

Install Skaffold:

```
wget -O skaffold https://storage.googleapis.com/skaffold/releases/latest/skaffold-linux-amd64
sudo install skaffold /usr/local/bin/
```

## Deploy

# For linux machines

The application can be started using `skaffold dev`.<br>
To access the application, visit `http://<IP OF MINIKUBE>/`.<br>
The IP of minikube can be queried using `minikube ip`.<br>

# For WSL users

The application can be started using `skaffold dev`. <br>
To expose the application outside your VM use `minikube service popular-slides-service --url`.<br>
The IP of the application can be accesses in your browser `http://localhost:<PORT OF APPLICATION>`.<br>
