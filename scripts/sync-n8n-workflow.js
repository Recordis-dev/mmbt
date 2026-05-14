import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workflowPath = "n8n/workflows/trench-predator-v1.1.workflow.json";
const snippetDirectory = "n8n/code-nodes";

const code = (file) => readFileSync(join(snippetDirectory, file), "utf8").trimEnd();

const codeNode = (id, name, file, position) => ({
  parameters: { jsCode: code(file) },
  id,
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position
});

const ifNode = (id, name, value1, operation, value2, position) => ({
  parameters: {
    conditions: {
      string: [{ value1, operation, value2 }]
    }
  },
  id,
  name,
  type: "n8n-nodes-base.if",
  typeVersion: 2,
  position
});

const webhookNode = (id, name, path, position) => ({
  parameters: {
    path,
    httpMethod: "POST",
    responseMode: "lastNode"
  },
  id,
  name,
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position
});

const connect = (connections, from, to, outputIndex = 0) => {
  connections[from] ??= { main: [] };
  connections[from].main[outputIndex] ??= [];
  connections[from].main[outputIndex].push({ node: to, type: "main", index: 0 });
};

const nodes = [
  webhookNode("telegram-webhook", "Telegram Webhook", "trench-signal", [240, 300]),
  codeNode("extract-token-address", "Extract Token Address", "01-extract-token-address.js", [460, 300]),
  ifNode("if-parsed", "IF Parsed", "={{ $json.status }}", "equal", "parsed", [680, 300]),
  codeNode("admission-control", "Admission Control", "02-admission-control.js", [900, 220]),
  ifNode("if-admitted", "IF Admitted", "={{ $json.status }}", "equal", "approved", [1120, 220]),
  codeNode("parallel-security-check", "Parallel Security Check", "03-parallel-security-check.js", [1340, 140]),
  ifNode("if-security-passed", "IF Security Passed", "={{ $json.status }}", "equal", "safe", [1560, 140]),
  codeNode("capture-learning-features", "Capture Learning Features", "09-capture-learning-features.js", [1780, 80]),
  codeNode("learning-admission-filter", "Learning Admission Filter", "11-learning-admission-filter.js", [2000, 80]),
  codeNode("dynamic-bet-size", "Dynamic Bet Size", "04-dynamic-bet-size.js", [2220, 80]),
  ifNode("if-trade-allowed", "IF Trade Allowed", "={{ $json.action }}", "equal", "TRADE", [2440, 80]),
  codeNode("jupiter-buy", "Jupiter Buy", "05-jupiter-buy.js", [2660, 20]),
  codeNode("log-buy-attempt", "Log Buy Attempt", "12-log-buy-attempt.js", [2880, 20]),
  {
    parameters: { amount: 5, unit: "seconds" },
    id: "monitor-wait",
    name: "Monitor Wait",
    type: "n8n-nodes-base.wait",
    typeVersion: 1,
    position: [3100, 20]
  },
  codeNode("monitor-exit-decision", "Monitor Exit Decision", "06-monitor-exit-decision.js", [3320, 20]),
  webhookNode("health-check-webhook", "Health Check Webhook", "trench-health-check", [240, 620]),
  codeNode("circuit-breaker-health-check", "Circuit Breaker Health Check", "07-circuit-breaker-health-check.js", [460, 620]),
  {
    parameters: {},
    id: "startup-recovery-manual",
    name: "Startup Recovery Manual",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [240, 820]
  },
  codeNode("startup-recovery", "Startup Recovery", "08-startup-recovery.js", [460, 820]),
  webhookNode("learning-outcome-webhook", "Learning Outcome Webhook", "trench-learning-outcome", [240, 1020]),
  codeNode("update-learning-outcome", "Update Learning Outcome", "10-update-learning-outcome.js", [460, 1020])
];

const connections = {};
connect(connections, "Telegram Webhook", "Extract Token Address");
connect(connections, "Extract Token Address", "IF Parsed");
connect(connections, "IF Parsed", "Admission Control", 0);
connect(connections, "Admission Control", "IF Admitted");
connect(connections, "IF Admitted", "Parallel Security Check", 0);
connect(connections, "Parallel Security Check", "IF Security Passed");
connect(connections, "IF Security Passed", "Capture Learning Features", 0);
connect(connections, "Capture Learning Features", "Learning Admission Filter");
connect(connections, "Learning Admission Filter", "Dynamic Bet Size");
connect(connections, "Dynamic Bet Size", "IF Trade Allowed");
connect(connections, "IF Trade Allowed", "Jupiter Buy", 0);
connect(connections, "Jupiter Buy", "Log Buy Attempt");
connect(connections, "Log Buy Attempt", "Monitor Wait");
connect(connections, "Monitor Wait", "Monitor Exit Decision");
connect(connections, "Health Check Webhook", "Circuit Breaker Health Check");
connect(connections, "Startup Recovery Manual", "Startup Recovery");
connect(connections, "Learning Outcome Webhook", "Update Learning Outcome");

const workflow = {
  name: "Trench Predator V1.1",
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  pinData: {}
};

writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Synced ${workflow.nodes.length} nodes into ${workflowPath}.`);
