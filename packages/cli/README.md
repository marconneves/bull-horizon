# @bull-horizon/cli

Command line interface for [bull-horizon](https://github.com/marconneves/bull-horizon)

## Installation

```sh
npm i -g @bull-horizon/cli
```

## Usage

```sh
Usage: bull-horizon -q queue1 queue2

Options:
  --redis-uri <uri>            redis uri (default: "redis://localhost:6379")
  -q, --queue <queues...>      queue names
  --bullmq                     use bullmq instead of bull
  -p, --port <number>          server's port (default: "3000")
  --host <string>              server's host (default: "localhost")
  --prefix <string>            redis key prefix (bull/bullmq)
  -m, --metrics                enable metrics collector
  --max-metrics <number>       max metrics (default: "100")
  --metrics-interval <number>  metrics collection interval in seconds (default: "3600")
  -h, --help                   display help for command
```
