import { App, Tags } from "aws-cdk-lib";
import { CertStack } from "../lib/cert-stack.ts";
import { SiteStack } from "../lib/site-stack.ts";

// Pinned so CDK refuses credentials for any other account.
const ACCOUNT = "562200984824";

const app = new App();

//   -c domain=true   certificate + hscatarcalculator.lucasfrasca.com. Only after
//                    lucasfrasca.com's nameservers point at Route 53.
const domain = app.node.tryGetContext("domain") === "true";

const cert = domain
  ? new CertStack(app, "HscCert", { env: { account: ACCOUNT, region: "us-east-1" }, crossRegionReferences: true })
  : undefined;

new SiteStack(app, "HscSite", {
  env: { account: ACCOUNT, region: "ap-southeast-2" },
  crossRegionReferences: domain,
  terminationProtection: true,
  certificate: cert?.certificate,
});

Tags.of(app).add("Project", "hsc-atar-calc");
