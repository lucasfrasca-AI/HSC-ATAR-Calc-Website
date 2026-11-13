import { Stack, type StackProps } from "aws-cdk-lib";
import { Certificate, CertificateValidation, type ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import type { Construct } from "constructs";
import { HOST, PARENT, WWW_HOST, ZONE_ID } from "./rules.ts";

/** CloudFront only accepts certificates from us-east-1. ACM writes its own
 *  validation records into the Route 53 zone, so this only finishes once
 *  lucasfrasca.com's nameservers point at Route 53. */
export class CertStack extends Stack {
  readonly certificate: ICertificate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const zone = HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: ZONE_ID, zoneName: PARENT });
    this.certificate = new Certificate(this, "Certificate", {
      domainName: HOST,
      subjectAlternativeNames: [WWW_HOST],
      validation: CertificateValidation.fromDns(zone),
    });
  }
}
