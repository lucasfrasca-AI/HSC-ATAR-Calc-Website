import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { CertStack } from "../lib/cert-stack.ts";
import { HOST, globalHeaders, viewerRequestCode, viewerResponseCode } from "../lib/rules.ts";
import { REPO_SUB, SiteStack } from "../lib/site-stack.ts";

type Handler = (event: unknown) => any;
const load = (code: string): Handler => new Function(`${code};return handler;`)();
const request = load(viewerRequestCode());
const response = load(viewerResponseCode());

const ask = (uri: string, host = HOST, querystring = {}) =>
  request({ request: { uri, querystring, headers: { host: { value: host } } } });
const cache = (uri: string, statusCode = 200) =>
  response({ request: { uri }, response: { statusCode, headers: {} } }).headers["cache-control"].value;

test("www goes to the main address with path and query; other hosts pass", () => {
  const r = ask("/a", `www.${HOST}`, { x: { value: "1" }, y: { value: "" } });
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location.value, `https://${HOST}/a?x=1&y`);
  assert.equal(ask("/a").uri, "/a");
  assert.equal(ask("/", "d123.cloudfront.net").uri, "/");
});

// Measured on https://hsc-atar-calc.web.app, 2026-11-13.
test("Cache-Control matches Firebase", () => {
  assert.equal(cache("/"), "no-cache");
  assert.equal(cache("/index.html"), "no-cache");
  assert.equal(cache("/assets/index-abc.js"), "public, max-age=31536000, immutable");
  assert.equal(cache("/favicon-32.png"), "max-age=3600");
  assert.equal(cache("/.well-known/security.txt"), "max-age=3600");
  assert.equal(cache("/assets/missing.js", 404), "no-cache");
  assert.equal(cache("/nope", 404), "no-cache");
});

test("functions fit CloudFront's 10 KB limit", () => {
  for (const code of [viewerRequestCode(), viewerResponseCode()]) assert.ok(Buffer.byteLength(code) < 10_240);
});

const synth = (domain: boolean) => {
  const app = new App();
  const env = { account: "562200984824" };
  const cert = domain ? new CertStack(app, "C", { env: { ...env, region: "us-east-1" }, crossRegionReferences: true }) : undefined;
  const site = new SiteStack(app, "S", { env: { ...env, region: "ap-southeast-2" }, crossRegionReferences: domain, certificate: cert?.certificate });
  return Template.fromStack(site);
};

test("the CSP served is firebase.json's, with the theme script hash", () => {
  const csp = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "firebase.json"), "utf8")).hosting.headers[0].headers[0].value;
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.equal(globalHeaders()["content-security-policy"], csp);
  synth(false).hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
    ResponseHeadersPolicyConfig: Match.objectLike({
      SecurityHeadersConfig: Match.objectLike({
        ContentSecurityPolicy: { ContentSecurityPolicy: csp, Override: true },
        FrameOptions: { FrameOption: "DENY", Override: true },
        StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31556926 }),
      }),
    }),
  });
});

test("the bucket is private and only reachable through CloudFront", () => {
  const t = synth(false);
  t.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
  });
  t.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({ DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }) }),
  });
});

test("the deploy role is main-only and can only read outputs, upload and clear the cache", () => {
  const t = synth(false);
  t.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: [Match.objectLike({ Condition: { StringEquals: Match.objectLike({ "token.actions.githubusercontent.com:sub": REPO_SUB }) } })],
    }),
  });
  const actions = Object.values(t.findResources("AWS::IAM::Policy")).flatMap((p: any) =>
    p.Properties.PolicyDocument.Statement.flatMap((s: any) => [s.Action].flat()),
  );
  assert.deepEqual([...new Set(actions)].sort(), ["cloudformation:DescribeStacks", "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "s3:ListBucket", "s3:PutObject"]);
});

test("without the domain flag there are no DNS records or aliases", () => {
  const t = synth(false);
  t.resourceCountIs("AWS::Route53::RecordSet", 0);
  t.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({ Aliases: Match.absent() }),
  });
});

test("with the domain flag both addresses get A and AAAA aliases", () => {
  const t = synth(true);
  t.resourceCountIs("AWS::Route53::RecordSet", 4);
  t.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({ Aliases: [HOST, `www.${HOST}`] }),
  });
});
