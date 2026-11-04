# GT-10G: local Gateway auth CORS configuration

Prepared only; no AWS reads/writes or deployment in this task.

## Cause and ownership

The deployed API `2v8o0dlq2g` is API Gateway REST (EDGE), stage `develop`,
with a Cognito user-pool authorizer. GT-10F captured an anonymous Owner snapshot
401 without CORS. Its method requires Cognito; Gateway rejects missing credentials
before Lambda invocation. The matching GatewayResponse is UNAUTHORIZED.
This attribution follows saved HTTP evidence and deployment metadata, not a new
CloudWatch trace. Lambda ResponseBuilder adds CORS even to its own 401/403.

Installed Syndicate 1.21.3 API resource code comments out the call to
`_customize_gateway_responses`; its helper only adds a wildcard origin to all
response types. No active metadata support for targeted GatewayResponses was
found. Do not add an ignored metadata key or modify the installed dependency.

## Minimal supported configuration

`gateway-auth-cors.json` contains two native API Gateway UpdateGatewayResponse
request payloads. Each sets its original status explicitly (UNAUTHORIZED401,
ACCESS_DENIED403), and adds only Access-Control-Allow-Origin for the exact
frontend origin, without a trailing slash. Quotes around the literal are required
by API Gateway's response-parameter mapping syntax.

No response templates, request-header reflection, token claims, cookies,
Allow-Credentials, expose headers or wildcard are added. Default error bodies
remain unchanged. Existing Lambda responses and OPTIONS methods are untouched.
Actual error responses need Allow-Origin; Allow-Headers/Allow-Methods belong to
the separate successful preflight, already verified in GT-10F for signin.
Protected-route OPTIONS support is checked against metadata locally; its live
headers and browser behavior still require post-update smoke.

ACCESS_DENIED covers the adjacent Gateway authorization403. Lambda Admin/Owner
role failures retain existing403 behavior. MISSING_AUTHENTICATION_TOKEN (including
wrong resource/method), EXPIRED_TOKEN/INVALID_SIGNATURE (AWS signature errors),
authorizer infrastructure500 and DEFAULT_4XX/5XX are not changed without evidence.
Cognito rejected/expired JWTs use the UNAUTHORIZED401 path. No token is created
or sent in this task.

## Separate approval required before execution

1. Read-only identity check: account955094289797,region eu-north-1, project cache.
2. GetRestApi/GetStage/GetGatewayResponse for both types and check for conflicts.
   Record the current stage deployment ID; ensure no unrelated pending API changes.
3. Two UpdateGatewayResponse PATCH calls, using the two payloads exactly.
   No Lambda/IAM/authorizer/method/integration changes or broad Syndicate deploy.
4. One CreateDeployment for this REST API with stageName `develop`; this creates
   a deployment snapshot and advances the existing stage. Stop if its snapshot
   could include unrelated pending changes. Do not create another API/stage.
5. Read-only check both response definitions, anonymous protected GET401,
   preflight, existing public GET, and Lambda403 when an approved real test
   identity exists. Browser must see status401, not a generic CORS/network error.
   Do not claim ACCESS_DENIED enforcement or authenticated E2E without real tests.

AWS documents GatewayResponse changes as requiring REST API redeployment.
These operations need deploy-time API Gateway PATCH permissions on the two
gatewayresponses and POST on deployments; no runtime IAM expansion.
Future full Syndicate API updates must preserve/recheck this explicit overlay;
it is not automatically bundled by the current workflow.

## Offline verification

From the repository root, with existing dependencies:

```sh
.venv/bin/python -B -m unittest discover -s marathon2026/infra/tests -p 'test_gateway_auth_cors.py'
```

Tests validate the installed botocore UpdateGatewayResponse schema, statuses,
exact-origin mapping, no auth data reflection, protected OPTIONS metadata and
unchanged Cognito requirements. They do not prove live Gateway/browser behavior.

Sources:
- https://docs.aws.amazon.com/apigateway/latest/developerguide/supported-gateway-response-types.html
- https://docs.aws.amazon.com/apigateway/latest/api/API_UpdateGatewayResponse.html
- https://docs.aws.amazon.com/apigateway/latest/developerguide/updating-api.html
