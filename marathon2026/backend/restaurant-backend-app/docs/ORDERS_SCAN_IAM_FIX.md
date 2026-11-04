# GT-11B: Orders popularity Scan permission

LOCAL preparation only. No AWS operations in GT-11B.

Execution chain: GetAllDishesHandler -> api-handler -> api-handler-role ->
customer-managed policy lambda-basic-execution. Role/policy binding follows the
deployed GT-09C metadata and earlier live-policy verification, not a fresh AWS read.

Only TableOrders gains dynamodb:Scan. Its resource remains the exact Orders table,
resolved in eu-north-1/account955094289797. No GSI permission is required.
All other actions/resources, explicit deployment-storage Deny and other Lambda
policies remain identical. Source templates retain account/region variables.

Prepared deployment document (ignored, outside bundles):
`/Users/ihorfedorov/Projects/green-tasty-marathon/.tools/deployment/eu-north-1/gt11b-orders-scan-policy.json`

SHA256: b4f8bc973fb147177e0ca49d125be987d6cb1bf6e12d286e5790899378740907

Compact document6062characters, below6144limit. Existing GT-09C bundles and ZIPs
are historical deployed evidence and intentionally unchanged; do not redeploy
their stale policy over this later fix.

## Smallest future AWS operation — separate approval required

Read-only preflight must verify isolated account/region, current Lambda role,
policy attachments (only intended api-handler-role), default policy version and
version slots. Compare live default document to prepared document with just the
new Scan removed. Stop on drift or unexpected attachments. Preserve before-version
ID for manual recovery. If five versions exist, stop: deletion is not authorized.

Then exactly one CreatePolicyVersion, setting it as default:

```sh
aws iam create-policy-version \
  --policy-arn arn:aws:iam::955094289797:policy/lambda-basic-execution \
  --policy-document file:///Users/ihorfedorov/Projects/green-tasty-marathon/.tools/deployment/eu-north-1/gt11b-orders-scan-policy.json \
  --set-as-default \
  --profile green-tasty-marathon --region eu-north-1
```

Use the isolated project AWS configuration/cache, not the ordinary profile cache.
No attach-role-policy, role mutation, Lambda update, bundle upload, Syndicate,
API Gateway stage deployment, Terraform or frontend rebuild is needed. API Gateway
GatewayResponse CORS overlay is untouched; future API deployments must preserve it.

After approval/execution: read default policy and anonymous popularity GET.
IAM propagation may delay visibility; no automatic repeat write/rollback.
Empty dishes should return200[] before seed; do not claim populated menu/E2E.
Scan cost/latency grows with Orders size; this fixes the existing contract without
redesigning popularity. No seed/users creation is included.

Offline checks:10IAM focused and24Python regression passed. Baseline hash tests
verify all three policies unchanged after removing the sole approved addition.
Resolved document minus Scan equals deployed GT-09C policy exactly. Standard
git diff check reports existing CRLF lines; cr-at-eol-aware check passes.
