import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as EdgeFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FederatedPrincipal, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ARecord, AaaaRecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import {
  HOST,
  HSTS_MAX_AGE_SECONDS,
  PARENT,
  WWW_HOST,
  ZONE_ID,
  globalHeaders,
  viewerRequestCode,
  viewerResponseCode,
} from "./rules.ts";

// GitHub's token names the repo by immutable id as well as by name.
export const REPO_SUB = "repo:lucasfrasca-AI@263276056/HSC-ATAR-Calc-Website@1411461027:ref:refs/heads/main";
const GITHUB_OIDC = (account: string) => `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;

type SiteProps = StackProps & {
  /** Set once the nameservers point at Route 53: adds the certificate, the two
   *  addresses and their DNS records. Without it the site answers only on its
   *  cloudfront.net address. */
  certificate?: ICertificate;
};

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteProps) {
    super(scope, id, props);

    const bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { noncurrentVersionExpiration: Duration.days(30), abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });

    const { "content-security-policy": csp, "permissions-policy": permissions, "cross-origin-opener-policy": coop } =
      globalHeaders();
    if (!csp || !permissions || !coop) throw new Error("firebase.json lost a security header");

    // Applies to error responses too, so a 404 carries the same protections.
    const headers = new ResponseHeadersPolicy(this, "Headers", {
      responseHeadersPolicyName: "hsc-atar-calc",
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.seconds(HSTS_MAX_AGE_SECONDS), override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: "permissions-policy", value: permissions, override: true },
          { header: "cross-origin-opener-policy", value: coop, override: true },
        ],
      },
    });

    const viewerRequest = new EdgeFunction(this, "ViewerRequest", {
      functionName: "hsc-viewer-request",
      comment: "www to the main address.",
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(viewerRequestCode()),
    });
    const viewerResponse = new EdgeFunction(this, "ViewerResponse", {
      functionName: "hsc-viewer-response",
      comment: "Cache-Control by path. Generated from firebase.json.",
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(viewerResponseCode()),
    });

    const domain = Boolean(props.certificate);
    const distribution = new Distribution(this, "Distribution", {
      comment: HOST,
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_ALL,
      defaultRootObject: "index.html",
      certificate: props.certificate,
      domainNames: domain ? [HOST, WWW_HOST] : undefined,
      minimumProtocolVersion: domain ? SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: headers,
        functionAssociations: [
          { eventType: FunctionEventType.VIEWER_REQUEST, function: viewerRequest },
          { eventType: FunctionEventType.VIEWER_RESPONSE, function: viewerResponse },
        ],
      },
    });

    // Lets a missing file come back as 404, as on Firebase, rather than S3's 403.
    // CloudFront asks for "/" as index.html, so the bucket is never listed to viewers.
    bucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "CloudFrontSeesMissingFiles",
        principals: [new ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:ListBucket"],
        resources: [bucket.bucketArn],
        conditions: { StringEquals: { "AWS:SourceArn": distribution.distributionArn } },
      }),
    );

    if (domain) {
      const zone = HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: ZONE_ID, zoneName: PARENT });
      const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
      for (const [key, name] of [["Main", HOST], ["Www", WWW_HOST]] as const) {
        new ARecord(this, `A${key}`, { zone, recordName: name, target });
        new AaaaRecord(this, `Aaaa${key}`, { zone, recordName: name, target });
      }
    }

    // GitHub Actions publishes from main with a short-lived token: no stored key.
    // It can upload files and clear the cache, nothing else.
    const role = new Role(this, "DeployRole", {
      roleName: "hsc-github-deploy",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new FederatedPrincipal(
        GITHUB_OIDC(this.account),
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": REPO_SUB,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    role.addToPolicy(new PolicyStatement({ actions: ["s3:PutObject"], resources: [bucket.arnForObjects("*")] }));
    role.addToPolicy(new PolicyStatement({ actions: ["s3:ListBucket"], resources: [bucket.bucketArn] }));
    role.addToPolicy(
      new PolicyStatement({
        actions: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
      }),
    );

    // The deploy job reads the bucket and distribution from this stack's outputs.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/${this.stackName}/*`],
      }),
    );

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionDomain", { value: distribution.distributionDomainName });
    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
